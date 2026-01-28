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

const adsCacheMap = new Map<string, { data: any; time: number }>();
const creativeUrlCache = new Map<string, { url: string | null; time: number }>();
const CACHE_DURATION = 0; // disabled during debugging to avoid stale counts

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
  pagination?: { page: number; perPage: number }
): Promise<{ ads: Ad[]; total: number }> {
  try {
    if (!filters?.businessId) return { ads: [], total: 0 };

    const cacheKey = JSON.stringify({ ...filters, ...pagination });
    const cached = adsCacheMap.get(cacheKey);
    if (cached && (Date.now() - cached.time < CACHE_DURATION)) return cached.data;

    const page = pagination?.page ?? 1;
    const perPage = pagination?.perPage ?? PER_PAGE;

    const { data: groups, error: gErr } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('vector_group, items, rep_ad_archive_id')
      .eq('business_id', filters.businessId);

    if (gErr || !groups) throw gErr;

    const uniqueGroupsMap = new Map<number, any>();
    groups.forEach(g => {
      if (!uniqueGroupsMap.has(g.vector_group)) {
        uniqueGroupsMap.set(g.vector_group, g);
      }
    });
    let filteredGroups = Array.from(uniqueGroupsMap.values());

    // Фильтрация по displayFormat, startDate, endDate
    if (filters?.displayFormat) {
      // Получаем repIds для фильтрации по displayFormat
      const { data: formatData } = await supabase
        .from(ADS_TABLE)
        .select('ad_archive_id, display_format')
        .in('ad_archive_id', filteredGroups.map(g => g.rep_ad_archive_id));
      const allowedIds = new Set(
        (formatData || [])
          .filter(d => d.display_format === filters.displayFormat)
          .map(d => d.ad_archive_id)
      );
      filteredGroups = filteredGroups.filter(g => allowedIds.has(g.rep_ad_archive_id));
    }

    if (filters?.startDate || filters?.endDate) {
      const { data: dateData } = await supabase
        .from(ADS_TABLE)
        .select('ad_archive_id, start_date_formatted, end_date_formatted')
        .in('ad_archive_id', filteredGroups.map(g => g.rep_ad_archive_id));
      filteredGroups = filteredGroups.filter(g => {
        const ad = (dateData || []).find(d => d.ad_archive_id === g.rep_ad_archive_id);
        if (!ad) return false;
        let pass = true;
        if (filters.startDate) pass = pass && ad.start_date_formatted >= filters.startDate;
        if (filters.endDate) pass = pass && ad.end_date_formatted <= filters.endDate;
        return pass;
      });
    }

    // Фильтруем только группы с дубликатами >= 3
    const minDup = Math.max(filters?.duplicatesRange?.min ?? 3, 3);
    const maxDup = filters?.duplicatesRange?.max ?? Number.MAX_SAFE_INTEGER;
    filteredGroups = filteredGroups.filter(g => {
      const dups = Number(g.items) - 1;
      return dups >= minDup && dups <= maxDup;
    });

    if (filters?.aiDescription) {
      const descTerm = filters.aiDescription.toLowerCase();
      const { data: statusData } = await supabase
        .from(ADS_GROUPS_STATUS_VIEW)
        .select('vector_group, ai_description')
        .in('vector_group', filteredGroups.map(g => g.vector_group));

      const matchingIds = new Set(
        (statusData || [])
          .filter(s => s.ai_description?.toLowerCase().includes(descTerm))
          .map(s => s.vector_group)
      );
      filteredGroups = filteredGroups.filter(g => matchingIds.has(g.vector_group));
    }

    const repIds = filteredGroups.map(g => g.rep_ad_archive_id).filter(Boolean);
    const { data: dateData } = await supabase
      .from(ADS_TABLE)
      .select('ad_archive_id, created_at, start_date_formatted')
      .in('ad_archive_id', repIds);

    const dateMap = new Map(dateData?.map(d => [d.ad_archive_id, d]));

    // Всегда сортируем newest, если не задано явно
    filteredGroups.sort((a, b) => {
      const adA = dateMap.get(a.rep_ad_archive_id);
      const adB = dateMap.get(b.rep_ad_archive_id);
      return new Date(adB?.created_at || 0).getTime() - new Date(adA?.created_at || 0).getTime();
    });

    const total = filteredGroups.length;
    const pageGroups = filteredGroups.slice((page - 1) * perPage, page * perPage);
    const pageRepIds = pageGroups.map(g => g.rep_ad_archive_id);

    const [repAdsRes, statusRes, businessRes] = await Promise.all([
      supabase.from(ADS_TABLE).select('*').in('ad_archive_id', pageRepIds),
      supabase.from(ADS_GROUPS_STATUS_VIEW).select('*').in('vector_group', pageGroups.map(g => g.vector_group)),
      supabase.from('businesses').select('slug').eq('id', filters.businessId).single()
    ]);

    const repMap = new Map(repAdsRes.data?.map(r => [r.ad_archive_id, r]));
    const statusMap = new Map(statusRes.data?.map(s => [s.vector_group, s]));
    const slug = businessRes.data?.slug;

    // Fetch authoritative counts from `ads` table for the page groups to avoid stale `g.items`
    const groupVectorIds = pageGroups.map(g => g.vector_group).filter(v => typeof v !== 'undefined' && v !== null);
    let countsMap = new Map<string, number>();
    if (groupVectorIds.length > 0) {
      try {
        let q = supabase
          .from(ADS_TABLE)
          .select('vector_group, ad_archive_id')
          .in('vector_group', groupVectorIds as any);
        if (filters?.businessId) q = q.eq('business_id', filters.businessId);
        const { data: groupRows } = await q;
        if (groupRows) {
          const tmp = new Map<string, number>();
          groupRows.forEach((row: any) => {
            const vg = String(row.vector_group);
            tmp.set(vg, (tmp.get(vg) || 0) + 1);
          });
          countsMap = tmp;
        }
      } catch (err) {
        console.error('fetchAds: failed to fetch group counts from ads table', err);
      }
    }

    const ads: Ad[] = [];
    for (const g of pageGroups) {
      const rep = repMap.get(g.rep_ad_archive_id);
      if (!rep) continue;

      const status = statusMap.get(g.vector_group);
      const imageUrl = await getCreativeUrl(rep.ad_archive_id, slug);

      const authoritativeItems = countsMap.get(String(g.vector_group)) ?? (typeof g.items !== 'undefined' ? Number(g.items) : null);
      ads.push({
        ...rep,
        id: rep.ad_archive_id,
        group_status: status?.status || 'Stable',
        duplicates_count: authoritativeItems !== null ? Number(authoritativeItems) : undefined,
        items: authoritativeItems !== null ? Number(authoritativeItems) : undefined,
        group_items: typeof g.items !== 'undefined' ? Number(g.items) : undefined,
        image_url: imageUrl || undefined,
        vector_group: g.vector_group,
        meta_ad_url: `https://www.facebook.com/ads/library/?id=${rep.ad_archive_id}`,
        ai_description: status?.ai_description || rep.ai_description
      });
    }

    const result = { ads, total };
    adsCacheMap.set(cacheKey, { data: result, time: Date.now() });
    return result;

  } catch (err) {
    console.error('fetchAds error:', err);
    return { ads: [], total: 0 };
  }
}

/**
 * FETCH PAGE NAMES
 * Uses Server-side aggregation for high performance.
 */
export async function fetchPageNames(businessId: string) {
  const { data, error } = await supabase.rpc('get_page_counts', { bid_param: businessId });
  if (error) {
    console.error('[ERROR] Failed to fetch page names:', error);
    return [];
  }
  return data;
}

/**
 * SINGLE AD FETCH
 */
export async function fetchAdByArchiveId(adArchiveId: string, businessId?: string): Promise<Ad | null> {
  const { data, error } = await supabase
    .from(ADS_TABLE)
    .select('*')
    .eq('ad_archive_id', adArchiveId)
    .single();

  if (error || !data) return null;

  // Compute authoritative group size (items) from `ads` table for this business/vector_group
  let itemsCount: number | null = null;
  try {
    if (data.vector_group !== null && typeof data.vector_group !== 'undefined') {
      const res = await supabase
        .from(ADS_TABLE)
        .select('ad_archive_id', { count: 'exact', head: true })
        .eq('vector_group', data.vector_group)
        .eq('business_id', businessId || data.business_id);
      itemsCount = (res && (res as any).count) ?? null;
    }
  } catch (err) {
    console.error('fetchAdByArchiveId: failed to count group items', err);
  }

  return {
    ...data,
    id: data.ad_archive_id,
    duplicates_count: itemsCount !== null ? Number(itemsCount) : undefined,
    items: itemsCount !== null ? Number(itemsCount) : undefined,
    meta_ad_url: `https://www.facebook.com/ads/library/?id=${data.ad_archive_id}`
  } as Ad;
}

/**
 * Fetch related ads for a vector_group
 */
export async function fetchRelatedAds(vectorGroup: number, excludeAdId?: string, businessId?: string) {
  try {
    let q = supabase
      .from(ADS_TABLE)
      .select('*')
      .eq('vector_group', vectorGroup);

    if (businessId) q = q.eq('business_id', businessId);
    if (excludeAdId) q = q.neq('ad_archive_id', excludeAdId);

    const { data, error } = await q.limit(500);
    if (error || !data) return [];
    return data;
  } catch (err) {
    console.error('fetchRelatedAds error', err);
    return [];
  }
}

/**
 * Return a single representative ad for a group
 */
export async function fetchGroupRepresentative(vectorGroup: number, businessId?: string) {
  try {
    const { data: groupRow, error: gerr } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('rep_ad_archive_id')
      .eq('vector_group', vectorGroup)
      .eq('business_id', businessId)
      .maybeSingle();

    if (gerr || !groupRow?.rep_ad_archive_id) return null;

    const rep = await fetchAdByArchiveId(groupRow.rep_ad_archive_id, businessId);
    return rep;
  } catch (err) {
    console.error('fetchGroupRepresentative error', err);
    return null;
  }
}

/**
 * Return the public URL for a creative (best-effort)
 */
export async function getCreativeUrl(adArchiveId: string, businessSlug?: string): Promise<string | null> {
  try {
    if (!businessSlug) return null;
    // Return cached value when available
    const cached = creativeUrlCache.get(adArchiveId);
    if (cached && Date.now() - cached.time < CACHE_DURATION) return cached.url;

    // 1) Try to read storage_path from the ads table — authoritative
    try {
      const { data: adRow, error: adErr } = await supabase.from(ADS_TABLE).select('storage_path, business_id').eq('ad_archive_id', adArchiveId).maybeSingle();
      if (!adErr && adRow) {
        if (adRow.storage_path) {
          const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL
            ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`
            : null;
          const url = publicBase ? `${publicBase}${adRow.storage_path}` : null;
          creativeUrlCache.set(adArchiveId, { url: url || null, time: Date.now() });
          return url || null;
        }
      }
    } catch (e) {
      // ignore and fallthrough to list-based lookup
    }

    // 2) Fall back to searching the storage bucket for a file matching the ad id
    try {
      // Use storage list with search to find filenames containing the ad id
      const listRes: any = await supabase.storage.from(STORAGE_BUCKET).list(businessSlug, { limit: 1000, search: adArchiveId });
      const files = listRes?.data || [];
      if (files.length > 0) {
        // prefer an exact name match like <adArchiveId>.<ext>
        let foundName: string | null = null;
        for (const f of files) {
          if (!f.name) continue;
          const name = f.name as string;
          if (name === `${adArchiveId}` || name.startsWith(`${adArchiveId}.`) || name.includes(`${adArchiveId}.`)) {
            foundName = name;
            break;
          }
        }
        // fallback to first file
        if (!foundName && files[0]?.name) foundName = files[0].name;

        if (foundName) {
          const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL
            ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`
            : null;
          const url = publicBase ? `${publicBase}${businessSlug}/${foundName}` : null;
          creativeUrlCache.set(adArchiveId, { url: url || null, time: Date.now() });
          return url || null;
        }
      }
    } catch (e) {
      // listing may fail for permission/network reasons — treat as not found
    }

    // 3) As a last resort, construct a plausible PNG path (legacy behavior)
    const legacyPath = `${businessSlug}/${adArchiveId}.png`;
    const publicRes: any = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(legacyPath);
    const url = publicRes?.data?.publicUrl || publicRes?.publicUrl || publicRes?.data?.publicURL || publicRes?.publicURL;
    creativeUrlCache.set(adArchiveId, { url: url || null, time: Date.now() });
    return url || null;
  } catch (err) {
    console.error('getCreativeUrl error', err);
    return null;
  }
}

/**
 * Alias used in places expecting getImageUrl
 */
export async function getImageUrl(adArchiveId: string, businessSlug?: string) {
  return getCreativeUrl(adArchiveId, businessSlug);
}

/**
 * Fetch business slug by id
 */
export async function getBusinessSlug(businessId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('businesses').select('slug').eq('id', businessId).single();
    if (error || !data) return null;
    return data.slug || null;
  } catch (err) {
    console.error('getBusinessSlug error', err);
    return null;
  }
}

/**
 * Get min/max dates for a vector group
 */
export async function getGroupDateRange(vectorGroup: number) {
  try {
    const { data: minRow } = await supabase
      .from(ADS_TABLE)
      .select('start_date_formatted')
      .eq('vector_group', vectorGroup)
      .order('start_date_formatted', { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: maxRow } = await supabase
      .from(ADS_TABLE)
      .select('end_date_formatted')
      .eq('vector_group', vectorGroup)
      .order('end_date_formatted', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      minStartDate: minRow?.start_date_formatted || null,
      maxEndDate: maxRow?.end_date_formatted || null,
    };
  } catch (err) {
    console.error('getGroupDateRange error', err);
    return { minStartDate: null, maxEndDate: null };
  }
}

/**
 * Compute a practical title when title is missing
 */
export function getEffectiveTitle(title: string | null | undefined, cardsJson: string | null | undefined, opts?: { caption?: string | null; text?: string | null }) {
  if (title && String(title).trim()) return title;
  try {
    if (cardsJson) {
      const cards = typeof cardsJson === 'string' ? JSON.parse(cardsJson) : cardsJson;
      if (Array.isArray(cards) && cards.length > 0) {
        const first = cards[0];
        if (first.title) return first.title;
        if (first.text) return first.text;
      }
    }
  } catch (e) {
    // ignore
  }
  if (opts?.caption) return opts.caption;
  if (opts?.text) return opts.text;
  return 'Untitled';
}

/**
 * Compute duplicates stats (min/max) for a business
 */
export async function fetchDuplicatesStats(businessId: string, pageName?: string, niche?: string, opts?: { startDate?: string; endDate?: string; displayFormat?: string }) {
  try {
    // Use ads_groups_test table directly to get all groups
    let q = supabase.from(ADS_GROUPS_TABLE).select('items').eq('business_id', businessId);
    const { data, error } = await q;
    if (error || !data) return { min: 0, max: 0 };
    const duplicates = data.map((r: any) => Number(r.items || 0) - 1).filter(d => d >= 0);
    const min = duplicates.length ? Math.min(...duplicates) : 0;
    const max = duplicates.length ? Math.max(...duplicates) : 0;
    return { min, max };
  } catch (err) {
    console.error('fetchDuplicatesStats error', err);
    return { min: 0, max: 0 };
  }
}

/**
 * Fetch metadata for a single vector group.
 * Returns count, content_types, first_seen, last_seen, active_period_days
 */
export async function getGroupMetadata(vectorGroup: number, businessId?: string) {
  try {
    let q = supabase.from(ADS_TABLE).select('display_format, start_date_formatted, end_date_formatted').eq('vector_group', vectorGroup);
    if (businessId) q = q.eq('business_id', businessId);

    const { data, error } = await q.limit(10000);
    if (error || !data) return null;

    const count = data.length;
    const contentTypesSet = new Set<string>();
    let firstSeen: string | null = null;
    let lastSeen: string | null = null;

    for (const row of data) {
      if (row.display_format) contentTypesSet.add(String(row.display_format));
      const s = row.start_date_formatted;
      const e = row.end_date_formatted;
      if (s) {
        if (!firstSeen || new Date(s) < new Date(firstSeen)) firstSeen = s;
      }
      if (e) {
        if (!lastSeen || new Date(e) > new Date(lastSeen)) lastSeen = e;
      }
    }

    let activeDays = 0;
    if (firstSeen && lastSeen) {
      const diff = new Date(lastSeen).getTime() - new Date(firstSeen).getTime();
      activeDays = Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
    }

    return {
      count,
      content_types: Array.from(contentTypesSet),
      first_seen: firstSeen,
      last_seen: lastSeen,
      active_period_days: activeDays,
    };
  } catch (err) {
    console.error('getGroupMetadata error', err);
    return null;
  }
}