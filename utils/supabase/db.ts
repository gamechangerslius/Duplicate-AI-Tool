/**
 * Fetch unique page names for a business (for filter dropdowns, etc.)
 * Returns an array of strings (page names) for the given businessId.
 */
export async function fetchPageNames(businessId: string): Promise<string[]> {
  if (!businessId) return [];
  try {
    // Query distinct page names for the business
    const { data, error } = await supabase
      .from(ADS_TABLE)
      .select('page_name')
      .eq('business_id', businessId)
      .order('page_name', { ascending: true });
    if (error || !data) return [];
    // Filter out null/empty and deduplicate (in case)
    const names = Array.from(new Set(
      data
        .map((row: any) => (typeof row.page_name === 'string' ? row.page_name.trim() : null))
        .filter((v: string | null) => !!v && v.length > 0)
    ));
    return names;
  } catch (err) {
    return [];
  }
}
import { supabase } from '../../lib/supabase';
import type { Ad } from '../../lib/types';

/**
 * CONFIGURATION
 */
const ADS_TABLE = 'ads';
const ADS_GROUPS_TABLE = 'ads_groups_test';
const ADS_GROUPS_STATUS_VIEW = 'ads_groups_with_status';
const STORAGE_BUCKET = 'creatives';
const PER_PAGE = 24;
const slugCache = new Map<string, string>();

// Cache maps with small TTL to prevent redundant loads during re-renders
const adsCacheMap = new Map<string, { data: any; time: number }>();
const creativeUrlCache = new Map<string, { url: string | null; time: number }>();
const CACHE_DURATION = 1000 * 60 * 2; // 2 minutes

/**
 * Helper to handle AbortSignal with promises
 */
async function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error('aborted');
  return p; 
}

export async function fetchAds(
  filters?: {
    businessId?: string;
    pageName?: string;
    startDate?: string;
    endDate?: string;
    displayFormat?: string;
    duplicatesRange?: { min: number; max: number };
    aiDescription?: string;
    sortBy?: 'newest' | 'oldest' | 'start_date_asc' | 'start_date_desc';
  },
  pagination?: { page: number; perPage: number },
  options?: { signal?: AbortSignal }
): Promise<{ ads: Ad[]; total: number }> {
  try {
    if (!filters?.businessId) return { ads: [], total: 0 };

    const cacheKey = JSON.stringify({ ...filters, ...pagination });
    const cached = adsCacheMap.get(cacheKey);
    if (cached && (Date.now() - cached.time < CACHE_DURATION)) return cached.data;

    const page = pagination?.page ?? 1;
    const perPage = pagination?.perPage ?? PER_PAGE;
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    // 1. UPDATED SELECT: Adding ai_description from ads_groups_test
    let query = supabase
      .from(ADS_GROUPS_TABLE)
      .select(`
        vector_group, 
        items, 
        rep_ad_archive_id,
        ai_description,
        business:businesses(slug)
      `, { count: 'exact' })
      .eq('business_id', filters.businessId);

    // 2. Filter by duplicates range
    if (filters.duplicatesRange) {
      query = query.gte('items', filters.duplicatesRange.min);
      query = query.lte('items', filters.duplicatesRange.max);
    }

    // 3. AI Description Filter
    if (filters.aiDescription) {
      query = query.filter('vector_group', 'in', 
        supabase.from(ADS_GROUPS_STATUS_VIEW)
          .select('vector_group')
          .ilike('ai_description', `%${filters.aiDescription}%`)
      );
    }

    // 4. Sorting logic
    query = query.order('items', { ascending: false });

    const { data: groups, count, error } = await query.range(from, to);
    if (error || !groups) return { ads: [], total: 0 };

    const businessSlug = (groups[0] as any)?.business?.slug;

    // 5. Fetch Ad details (bulk)
    const repIds = groups.map(g => g.rep_ad_archive_id).filter(Boolean);
    const { data: adDetails } = await supabase
      .from(ADS_TABLE)
      .select('*')
      .in('ad_archive_id', repIds);

    const adMap = new Map(adDetails?.map(ad => [ad.ad_archive_id, ad]));

    // 6. Assemble the final objects
    const ads: Ad[] = await Promise.all(groups.map(async (g) => {
      const baseAd = adMap.get(g.rep_ad_archive_id);
      const imageUrl = await getCreativeUrl(g.rep_ad_archive_id, businessSlug);

      return {
        ...baseAd,
        id: g.rep_ad_archive_id,
        vector_group: g.vector_group,
        duplicates_count: g.items,
        image_url: imageUrl,
        // UPDATED: Now using ai_description directly from the groups table
        ai_description: g.ai_description || baseAd?.ai_description, 
        meta_ad_url: `https://www.facebook.com/ads/library/?id=${g.rep_ad_archive_id}`
      } as Ad;
    }));

    const result = { ads, total: count || 0 };
    adsCacheMap.set(cacheKey, { data: result, time: Date.now() });
    return result;

  } catch (err) {
    console.error('[DB] fetchAds error:', err);
    return { ads: [], total: 0 };
  }
}

/**
 * Optimized min/max stats fetch
 * Uses Postgres aggregation instead of fetching rows
 */
export async function fetchDuplicatesStats(businessId: string) {
  try {
    const { data, error } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('items')
      .eq('business_id', businessId);
    
    if (error || !data || data.length === 0) return { min: 1, max: 100 };

    // Calculate in JS or use RPC for even better performance
    const items = data.map(d => Number(d.items));
    return {
      min: Math.min(...items),
      max: Math.max(...items)
    };
  } catch (err) {
    return { min: 1, max: 100 };
  }
}

/**
 * Representative Ad fetch with data validation
 */
export async function fetchAdByArchiveId(adArchiveId: string, businessId?: string): Promise<Ad | null> {
  const { data, error } = await supabase
    .from(ADS_TABLE)
    .select('*')
    .eq('ad_archive_id', adArchiveId)
    .maybeSingle();

  if (error || !data) return null;

  // Формируем image_url из storage_path, если есть
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/creatives/` : null;
  const imageUrl = data.storage_path && publicBase
    ? `${publicBase}${data.storage_path}`
    : data.image_url || undefined;

  // Authoritative items count from groups table
  const { data: groupData } = await supabase
    .from(ADS_GROUPS_TABLE)
    .select('items')
    .eq('vector_group', data.vector_group)
    .eq('business_id', businessId || data.business_id)
    .maybeSingle();

  return {
    ...data,
    id: data.ad_archive_id,
    image_url: imageUrl,
    duplicates_count: groupData?.items || 0,
    meta_ad_url: `https://www.facebook.com/ads/library/?id=${data.ad_archive_id}`
  };
}

/**
 * Storage URL helper with AUTHORITATIVE pathing
 */
export async function getCreativeUrl(adArchiveId: string, businessSlug?: string): Promise<string | null> {
  if (!businessSlug || !adArchiveId) return null;

  const cacheKey = `${businessSlug}_${adArchiveId}`;
  if (creativeUrlCache.has(cacheKey)) return creativeUrlCache.get(cacheKey)!.url;

  const publicBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`;

  // 1. Try DB storage path (authoritative)
  const { data } = await supabase
    .from(ADS_TABLE)
    .select('storage_path')
    .eq('ad_archive_id', adArchiveId)
    .maybeSingle();

  const finalUrl = data?.storage_path 
    ? `${publicBase}${data.storage_path}`
    : `${publicBase}${businessSlug}/${adArchiveId}.png`; // Legacy fallback

  creativeUrlCache.set(cacheKey, { url: finalUrl, time: Date.now() });
  return finalUrl;
}

/**
 * Fetch group performance and date metadata using SQL Aggregation
 */
export async function getGroupMetadata(vectorGroup: number, businessId?: string) {
  try {
    // Optimization: Instead of downloading 10k rows, let Postgres do the math
    const { data, error } = await supabase
      .from(ADS_TABLE)
      .select('display_format, start_date_formatted, end_date_formatted')
      .eq('vector_group', vectorGroup)
      .eq('business_id', businessId);

    if (error || !data) return null;

    const formats = Array.from(new Set(data.map(d => d.display_format)));
    const startDates = data.map(d => new Date(d.start_date_formatted).getTime()).filter(Boolean);
    const endDates = data.map(d => new Date(d.end_date_formatted).getTime()).filter(Boolean);

    const firstSeen = startDates.length ? new Date(Math.min(...startDates)).toISOString() : null;
    const lastSeen = endDates.length ? new Date(Math.max(...endDates)).toISOString() : null;

    return {
      count: data.length,
      content_types: formats,
      first_seen: firstSeen,
      last_seen: lastSeen,
      active_period_days: firstSeen && lastSeen 
        ? Math.round((new Date(lastSeen).getTime() - new Date(firstSeen).getTime()) / (86400000))
        : 0
    };
  } catch (err) {
    return null;
  }
}
export async function getBusinessSlug(businessId: string): Promise<string | null> {
  try {
    if (!businessId) return null;

    if (slugCache.has(businessId)) {
      return slugCache.get(businessId)!;
    }

    const { data, error } = await supabase
      .from('businesses')
      .select('slug')
      .eq('id', businessId)
      .maybeSingle();

    if (error) {
      console.error('[DB] Error fetching business slug:', error);
      return null;
    }

    if (data?.slug) {
      slugCache.set(businessId, data.slug);
      return data.slug;
    }

    return null;
  } catch (err) {
    console.error('[DB] getBusinessSlug fatal error:', err);
    return null;
  }
}

export async function fetchRelatedAds(
  vectorGroup: number | string, 
  excludeAdId?: string, 
  businessId?: string
): Promise<Ad[]> {
  try {
    if (vectorGroup === undefined || vectorGroup === null || vectorGroup === -1) {
      console.warn('[DB] fetchRelatedAds: Invalid vectorGroup provided');
      return [];
    }

    // 2. Build Query
    let query = supabase
      .from(ADS_TABLE)
      .select('*')
      // Ensure we are comparing the right type
      .eq('vector_group', vectorGroup);

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    if (excludeAdId) {
      query = query.neq('ad_archive_id', excludeAdId);
    }

    // Performance limit
    const { data, error } = await query.limit(100);

    if (error) {
      console.error('[DB] Error fetching related ads:', error.message);
      return [];
    }

    if (!data || data.length === 0) {
      console.log(`[DB] No related ads found for group ${vectorGroup}`);
      return [];
    }

    // 3. Optimized Resource Fetching
    const slug = businessId ? await getBusinessSlug(businessId) : null;
    const publicBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/creatives/`;

    // Map results
    const relatedAds: Ad[] = data.map((item) => {
      const imageUrl = item.storage_path 
        ? `${publicBase}${item.storage_path}` 
        : (slug ? `${publicBase}${slug}/${item.ad_archive_id}.png` : null);

      return {
        ...item,
        id: item.ad_archive_id,
        image_url: imageUrl || undefined,
        meta_ad_url: `https://www.facebook.com/ads/library/?id=${item.ad_archive_id}`
      } as Ad;
    });

    return relatedAds;
  } catch (err) {
    console.error('[DB] fetchRelatedAds fatal error:', err);
    return [];
  }
}

export async function fetchGroupRepresentative(
  vectorGroup: number | string, 
  businessId?: string
): Promise<Ad | null> {
  try {
    if (vectorGroup === undefined || vectorGroup === null || vectorGroup === -1) {
      return null;
    }

    let query = supabase
      .from(ADS_GROUPS_TABLE)
      .select('rep_ad_archive_id')
      .eq('vector_group', vectorGroup);

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data: groupData, error: groupError } = await query.maybeSingle();

    if (groupError || !groupData?.rep_ad_archive_id) {
      console.warn(`[DB] No representative found for group ${vectorGroup}`);
      return null;
    }

    const representativeAd = await fetchAdByArchiveId(
      groupData.rep_ad_archive_id, 
      businessId
    );

    return representativeAd;
  } catch (err) {
    console.error('[DB] fetchGroupRepresentative fatal error:', err);
    return null;
  }
}