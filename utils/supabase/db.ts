import { supabase } from '../../lib/supabase';
import type { Ad } from '../../lib/types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ADS_TABLE = 'ads';
const ADS_GROUPS_TABLE = 'ads_groups';
const STORAGE_BUCKET = 'creatives';
const PER_PAGE = 24;

const pageNamesCacheMap = new Map<string, { data: { name: string; count: number }[]; time: number }>();
const adsCacheMap = new Map<string, { data: { ads: any[]; total: number }; time: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const ADS_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes for ads

// Cache for resolved storage URLs (so we don't hit Storage APIs repeatedly)
const creativeUrlCache = new Map<string, { url: string | null; time: number }>();
const CREATIVE_URL_CACHE_MS = 10 * 60 * 1000; // 10 minutes

// Cache for group date ranges (min/max dates per vector_group)
const groupDateRangeCache = new Map<string, { data: { minStartDate: string | null; maxEndDate: string | null }; time: number }>();
const GROUP_DATE_CACHE_MS = 10 * 60 * 1000; // 10 minutes
const GROUP_DATE_RPC_TIMEOUT_MS = 2000; // fail fast to avoid UI hangs

function nowMs() {
  return Date.now();
}

function normalizeNiche(niche?: string) {
  const s = (niche || '').trim().toLowerCase();
  return s || '';
}

// Helper to get business slug from business_id
export async function getBusinessSlug(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('businesses')
    .select('slug')
    .eq('id', businessId)
    .single();
  
  return data?.slug || null;
}

// Get creative URL from storage: creatives/{{businessSlug}}/{{ad_archive_id}}.png
export async function getCreativeUrl(
  adArchiveId: string,
  businessIdOrSlug: string, // Can be business_id or slug
  opts?: {
    preferredExts?: string[];
    signedUrlTtlSeconds?: number;
  }
): Promise<string | null> {
  const exts = opts?.preferredExts ?? ['png', 'jpg', 'jpeg', 'webp'];
  const ttl = opts?.signedUrlTtlSeconds ?? 3600;

  // Resolve business slug
  let businessSlug = businessIdOrSlug;
  if (businessIdOrSlug.includes('-') && businessIdOrSlug.length > 30) {
    // Looks like a UUID, need to resolve slug
    const slug = await getBusinessSlug(businessIdOrSlug);
    if (!slug) return null;
    businessSlug = slug;
  }

  const folder = businessSlug; // creatives/{{businessSlug}}/
  const cacheKey = `${STORAGE_BUCKET}|${folder}|${adArchiveId}`;
  const cached = creativeUrlCache.get(cacheKey);
  const t = nowMs();
  if (cached && t - cached.time < CREATIVE_URL_CACHE_MS) return cached.url;

  const storage = supabase.storage.from(STORAGE_BUCKET);

  // Try standard extensions
  for (const ext of exts) {
    const fileName = `${adArchiveId}.${ext}`;
    const path = `${folder}/${fileName}`;

    // 1) Try public URL
    const pub = storage.getPublicUrl(path);
    const publicUrl = pub?.data?.publicUrl || null;

    if (publicUrl) {
      try {
        const r = await fetch(publicUrl, { method: 'HEAD' });
        if (r.ok) {
          creativeUrlCache.set(cacheKey, { url: publicUrl, time: t });
          return publicUrl;
        }
      } catch {
        // ignore and try signed
      }
    }

    // 2) Signed URL fallback
    try {
      const { data, error } = await storage.createSignedUrl(path, ttl);
      if (!error && data?.signedUrl) {
        creativeUrlCache.set(cacheKey, { url: data.signedUrl, time: t });
        return data.signedUrl;
      }
    } catch {
      // ignore and continue
    }
  }

  // Fallback: search in folder
  try {
    const { data: files, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(folder, { limit: 1000, search: adArchiveId });

    if (!error && files?.length) {
      const match = files.find((f) => {
        const n = f.name || '';
        return n.startsWith(adArchiveId);
      });

      if (match?.name) {
        const fallbackPath = `${folder}/${match.name}`;
        
        // Try public URL
        const pub = storage.getPublicUrl(fallbackPath);
        const publicUrl = pub?.data?.publicUrl || null;

        if (publicUrl) {
          try {
            const r = await fetch(publicUrl, { method: 'HEAD' });
            if (r.ok) {
              creativeUrlCache.set(cacheKey, { url: publicUrl, time: t });
              return publicUrl;
            }
          } catch {
            // ignore
          }
        }

        // Try signed URL
        const { data: signed, error: e2 } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(fallbackPath, ttl);

        if (!e2 && signed?.signedUrl) {
          creativeUrlCache.set(cacheKey, { url: signed.signedUrl, time: t });
          return signed.signedUrl;
        }
      }
    }
  } catch {
    // ignore
  }

  creativeUrlCache.set(cacheKey, { url: null, time: t });
  return null;
}

export function getImageUrl(adArchiveId: string, businessSlug: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${businessSlug}/${adArchiveId}.png`;
}

export function getMetaAdUrl(adArchiveId: string): string {
  return `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
}

function getTitleFromCards(cardsJson: any): string | null {
  if (!cardsJson) return null;

  try {
    let cards = cardsJson;
    if (typeof cardsJson === 'string') {
      cards = JSON.parse(cardsJson);
    }

    if (Array.isArray(cards) && cards.length > 0) {
      // Try to find a good title from the first card
      const firstCard = cards[0];
      if (typeof firstCard === 'object' && firstCard !== null) {
        // Try multiple fields in priority order
        const text = firstCard.title || firstCard.body || firstCard.name || firstCard.text || null;
        if (text && typeof text === 'string' && text.trim()) {
          // Trim and limit length for display
          return text.trim().substring(0, 200);
        }
      }
    }
  } catch {
    // silent
  }
  return null;
}

// Get effective title for an ad (prefers actual title, falls back to cards and other fields)
function getEffectiveTitle(title: string | null, cardsJson: any, additionalFields?: { caption?: string | null; text?: string | null }): string {
  // Check if title is valid and not a placeholder/template
  const isValidTitle = 
    title && 
    title.trim() && 
    !title.includes('{{') && // template placeholders
    !title.toLowerCase().includes('untitled') && // case-insensitive check for "untitled"
    title !== 'Untitled';
  
  if (isValidTitle) {
    return title;
  }
  
  // Try to get title from cards as first fallback
  const cardsTitle = getTitleFromCards(cardsJson);
  if (cardsTitle && cardsTitle.trim()) {
    return cardsTitle;
  }
  
  // Try caption or text fields if they exist and are valid
  if (additionalFields) {
    if (additionalFields.caption && typeof additionalFields.caption === 'string' && additionalFields.caption.trim()) {
      return additionalFields.caption.trim().substring(0, 200);
    }
    if (additionalFields.text && typeof additionalFields.text === 'string' && additionalFields.text.trim()) {
      return additionalFields.text.trim().substring(0, 200);
    }
  }
  
  return (title && title.trim()) ? title : 'Untitled';
}

/**
 * Calculate min/max dates for a vector_group across all ads in the group.
 * Returns the earliest start_date and latest end_date for all creatives in the group.
 * Results are cached to avoid repeated database queries.
 * Uses Supabase RPC function for optimized query.
 */
async function getGroupDateRange(vectorGroup: number): Promise<{ minStartDate: string | null; maxEndDate: string | null }> {
  if (vectorGroup === -1 || vectorGroup == null) {
    return { minStartDate: null, maxEndDate: null };
  }

  const cacheKey = `${vectorGroup}`;
  const cached = groupDateRangeCache.get(cacheKey);
  const t = nowMs();
  if (cached && t - cached.time < GROUP_DATE_CACHE_MS) {
    console.log(`✅ Cache hit for group ${vectorGroup}: ${cached.data.minStartDate} to ${cached.data.maxEndDate}`);
    return cached.data;
  }

  console.log(`🔍 Fetching group dates for vector_group=${vectorGroup}`);
  
  try {
    // Use Supabase RPC function for optimized query with a timeout guard
    const rpcPromise = supabase.rpc('get_group_date_range', { 
      target_table: ADS_TABLE,
      group_id: vectorGroup
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('rpc_timeout')), GROUP_DATE_RPC_TIMEOUT_MS);
    });

    const { data, error } = await Promise.race([rpcPromise, timeoutPromise]);

    console.log(`📥 RPC result for group ${vectorGroup}:`, { data, error });

    if (error || !data || !(data as any)[0]) {
      console.warn(`Failed to fetch group dates for ${vectorGroup}:`, error);
      return { minStartDate: null, maxEndDate: null };
    }

    const first = (data as any)[0];
    const result = {
      minStartDate: first.min_start || null,
      maxEndDate: first.max_end || null,
    };

    console.log(`✅ Group ${vectorGroup} dates: ${result.minStartDate} to ${result.maxEndDate}`);
    
    groupDateRangeCache.set(cacheKey, { data: result, time: t });
    return result;
  } catch (err) {
    console.error('Error in getGroupDateRange:', err);
    return { minStartDate: null, maxEndDate: null };
  }
}

export async function fetchDuplicatesStats(
  businessId: string,
  pageName?: string,
  competitorNiche?: string,
  opts?: { startDate?: string; endDate?: string; displayFormat?: 'IMAGE' | 'VIDEO' | 'ALL' }
): Promise<{ min: number; max: number }> {
  try {
    console.log('🔍 fetchDuplicatesStats called with:', { businessId, pageName, competitorNiche, opts });

    // Get all groups for the business from ads_groups table
    const { data: groups, error: groupsErr } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('vector_group, items, rep_ad_archive_id')
      .eq('business_id', businessId);

    if (groupsErr) {
      console.error('❌ fetchDuplicatesStats groups error:', groupsErr);
      return { min: 1, max: 100 };
    }

    if (!groups || groups.length === 0) {
      console.log('⚠️ No groups found for business');
      return { min: 1, max: 100 };
    }

    let filteredGroups = groups;

    // If filters provided, check representative ads
    if (pageName || competitorNiche || opts?.displayFormat || opts?.startDate || opts?.endDate) {
      const repIds = groups.map((g: any) => g.rep_ad_archive_id).filter(Boolean);
      if (repIds.length > 0) {
        let rq = supabase
          .from(ADS_TABLE)
          .select('ad_archive_id, page_name, competitor_niche, display_format, start_date_formatted, end_date_formatted')
          .in('ad_archive_id', repIds);
        
        if (pageName) rq = rq.eq('page_name', pageName);
        if (competitorNiche) rq = rq.eq('competitor_niche', normalizeNiche(competitorNiche));
        if (opts?.displayFormat && opts.displayFormat !== 'ALL') rq = rq.eq('display_format', opts.displayFormat);
        if (opts?.startDate) rq = rq.gte('start_date_formatted', opts.startDate);
        if (opts?.endDate) rq = rq.lte('end_date_formatted', opts.endDate);
        
        const { data: reps, error: rErr } = await rq;
        if (!rErr && reps) {
          const allowed = new Set(reps.map((r: any) => r.ad_archive_id));
          filteredGroups = filteredGroups.filter((g: any) => allowed.has(g.rep_ad_archive_id));
        }
      }
    }

    const counts = filteredGroups
      .map((g: any) => Number(g.items || 0))
      .filter((n) => !Number.isNaN(n) && n > 0);

    console.log('📊 Group statistics:');
    console.log('  Total groups:', filteredGroups.length);
    console.log('  Counts distribution (first 30):', counts.slice(0, 30));
    console.log('  Min:', Math.min(...counts), 'Max:', Math.max(...counts));

    if (counts.length === 0) return { min: 1, max: 100 };

    const result = { min: Math.min(...counts), max: Math.max(...counts) };
    console.log('✅ fetchDuplicatesStats result:', result);
    return result;
  } catch (err) {
    console.error('💥 Error fetching duplicates stats:', err);
    return { min: 1, max: 100 };
  }
}

export async function fetchAds(
  filters?: {
    businessId?: string;
    pageName?: string;
    duplicatesRange?: { min: number; max: number };
    competitorNiche?: string;
    startDate?: string;
    endDate?: string;
    displayFormat?: 'IMAGE' | 'VIDEO' | 'ALL';
  },
  pagination?: { page: number; perPage: number }
): Promise<{ ads: Ad[]; total: number }> {
  try {
    const cacheKey = JSON.stringify({ ...filters, ...pagination });
    const t = nowMs();
    const cached = adsCacheMap.get(cacheKey);
    if (cached && t - cached.time < ADS_CACHE_DURATION) {
      console.log('✅ Using cached data for fetchAds');
      return cached.data;
    }

    const page = pagination?.page ?? 1;
    const perPage = pagination?.perPage ?? PER_PAGE;

    if (!filters?.businessId) {
      console.warn('⚠️ fetchAds requires businessId');
      return { ads: [], total: 0 };
    }

    console.log('🔍 fetchAds called with filters:', filters, 'pagination:', pagination);

    // Step 1: Get all groups from ads_groups table
    const { data: groups, error: gErr } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('vector_group, items, rep_ad_archive_id')
      .eq('business_id', filters.businessId)
      .order('items', { ascending: false });

    if (gErr) {
      console.error('❌ fetchAds groups error:', gErr);
      return { ads: [], total: 0 };
    }

    if (!groups || groups.length === 0) {
      console.log('⚠️ No groups found');
      return { ads: [], total: 0 };
    }

    console.log('📊 Found', groups.length, 'groups in ads_groups');

    // Step 2: Filter by duplicates range
    const minDup = filters?.duplicatesRange?.min ?? 0;
    const maxDup = filters?.duplicatesRange?.max ?? Number.MAX_SAFE_INTEGER;

    let filteredGroups = groups.filter((g: any) => {
      const items = Number(g.items || 0);
      return items >= minDup && items <= maxDup;
    });

    console.log('📊 After duplicates filter:', filteredGroups.length, 'groups (min:', minDup, 'max:', maxDup, ')');

    // Step 3: If other filters provided, check representative ads
    if (filters?.pageName || filters?.competitorNiche || filters?.displayFormat || filters?.startDate || filters?.endDate) {
      const repIds = filteredGroups.map((g: any) => g.rep_ad_archive_id).filter(Boolean);
      if (repIds.length > 0) {
        let rq = supabase
          .from(ADS_TABLE)
          .select('ad_archive_id, page_name, competitor_niche, display_format, start_date_formatted, end_date_formatted')
          .in('ad_archive_id', repIds);
        
        if (filters?.pageName) rq = rq.eq('page_name', filters.pageName);
        if (filters?.competitorNiche) rq = rq.eq('competitor_niche', normalizeNiche(filters.competitorNiche));
        if (filters?.displayFormat && filters.displayFormat !== 'ALL') rq = rq.eq('display_format', filters.displayFormat);
        if (filters?.startDate) rq = rq.gte('start_date_formatted', filters.startDate);
        if (filters?.endDate) rq = rq.lte('end_date_formatted', filters.endDate);
        
        const { data: reps, error: rErr } = await rq;
        if (!rErr && reps) {
          const allowed = new Set(reps.map((r: any) => r.ad_archive_id));
          filteredGroups = filteredGroups.filter((g: any) => allowed.has(g.rep_ad_archive_id));
          console.log('📊 After filters:', filteredGroups.length, 'groups');
        }
      }
    }

    const totalGroups = filteredGroups.length;
    
    // Step 4: Paginate
    const start = (page - 1) * perPage;
    const end = Math.min(start + perPage, filteredGroups.length);
    const pageGroups = filteredGroups.slice(start, end);

    console.log('📄 Page', page, ': showing', pageGroups.length, 'of', totalGroups, 'groups');

    // Step 5: Fetch representative ad details for this page
    const repIds = pageGroups.map((g: any) => g.rep_ad_archive_id).filter(Boolean);
    const { data: repAds, error: repErr } = await supabase
      .from(ADS_TABLE)
      .select('ad_archive_id, business_id, title, page_name, text, caption, display_format, vector_group, competitor_niche, url, cards_json, start_date_formatted, end_date_formatted')
      .in('ad_archive_id', repIds);

    if (repErr) {
      console.error('❌ fetchAds reps error:', repErr);
    }

    const repMap = new Map<string, any>();
    for (const row of repAds || []) repMap.set(row.ad_archive_id, row);

    // Step 6: Resolve business slug for images
    const businessSlug = await getBusinessSlug(filters.businessId);

    // Step 7: Pre-fetch group dates
    const groupDatesCache = new Map<number, { minStartDate: string | null; maxEndDate: string | null }>();
    const uniqueVectorGroups = [...new Set(pageGroups.map((g: any) => g.vector_group))];

    for (const vg of uniqueVectorGroups) {
      if (vg === -1 || vg == null) continue;
      const dates = await getGroupDateRange(vg);
      groupDatesCache.set(vg, dates);
    }

    // Step 8: Resolve images
    const creativeUrls = await Promise.all(
      pageGroups.map((g: any) => {
        const rep = repMap.get(g.rep_ad_archive_id);
        if (businessSlug && rep) {
          return getCreativeUrl(rep.ad_archive_id, businessSlug);
        }
        return null;
      })
    );

    // Step 9: Build result
    const ads: Ad[] = pageGroups
      .map((g: any, i: number) => {
        const rep = repMap.get(g.rep_ad_archive_id);
        if (!rep) return null;
        
        const effectiveTitle = getEffectiveTitle(rep.title, rep.cards_json, { 
          caption: rep.caption, 
          text: rep.text 
        });
        
        const groupDates = groupDatesCache.get(g.vector_group) || { 
          minStartDate: null, 
          maxEndDate: null 
        };
        
        return {
          id: rep.ad_archive_id,
          ad_archive_id: rep.ad_archive_id,
          business_id: rep.business_id,
          title: effectiveTitle,
          page_name: rep.page_name,
          ad_text: rep.text ?? null,
          caption: rep.caption ?? null,
          url: rep.url ?? null,
          competitor_niche: rep.competitor_niche ?? null,
          display_format: rep.display_format,
          created_at: new Date().toISOString(),
          start_date_formatted: rep.start_date_formatted ?? groupDates.minStartDate ?? undefined,
          end_date_formatted: rep.end_date_formatted ?? groupDates.maxEndDate ?? undefined,
          vector_group: g.vector_group,
          duplicates_count: Number(g.items ?? 0),
          meta_ad_url: getMetaAdUrl(rep.ad_archive_id),
          image_url: creativeUrls[i] ?? undefined,
        };
      })
      .filter(Boolean) as Ad[];

    console.log('✅ Returning', ads.length, 'ads out of', totalGroups, 'total groups');

    const returnValue = { ads, total: totalGroups };
    adsCacheMap.set(cacheKey, { data: returnValue, time: nowMs() });
    return returnValue;
  } catch (err) {
    console.error('💥 Exception in fetchAds:', err);
    return { ads: [], total: 0 };
  }
}

/**
 * Fetch a single ad by ad_archive_id.
 */
export async function fetchAdByArchiveId(adArchiveId: string, businessId?: string): Promise<Ad | null> {
  let query = supabase.from(ADS_TABLE).select('*').eq('ad_archive_id', adArchiveId);
  
  if (businessId) {
    query = query.eq('business_id', businessId);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    console.warn(`Fetch ad ${adArchiveId} failed:`, JSON.stringify(error, null, 2));
    return null;
  }

  const row = data as any;
  const effectiveTitle = getEffectiveTitle(row.title, row.cards_json, { caption: row.caption, text: row.text });
  
  // Get business slug for image URL
  const businessSlug = await getBusinessSlug(row.business_id);
  const resolvedUrl = businessSlug ? await getCreativeUrl(row.ad_archive_id, businessSlug) : null;

  const groupDates = await getGroupDateRange(row.vector_group);

  const { embedding_vec, ...raw } = row;

  return {
    id: row.ad_archive_id,
    ad_archive_id: row.ad_archive_id,
    business_id: row.business_id,
    title: effectiveTitle,
    page_name: row.page_name,
    ad_text: row.ad_text ?? row.text ?? null,
    caption: row.caption ?? row.cta_text ?? null,
    url: row.url ?? null,
    competitor_niche: row.competitor_niche ?? null,
    display_format: row.display_format,
    created_at: row.created_at || new Date().toISOString(),
    vector_group: row.vector_group,
    duplicates_count: row.duplicates_count,
    meta_ad_url: getMetaAdUrl(row.ad_archive_id),
    image_url: resolvedUrl ?? undefined,
    start_date_formatted: groupDates.minStartDate ?? (row.start_date_formatted ?? null),
    end_date_formatted: groupDates.maxEndDate ?? (row.end_date_formatted ?? null),
    raw,
  };
}

export async function fetchAdById(id: string, businessId?: string): Promise<Ad | null> {
  return fetchAdByArchiveId(id, businessId);
}

export async function fetchRelatedAds(vectorGroup: number, currentAdArchiveId: string, businessId: string): Promise<Ad[]> {
  if (vectorGroup === -1) return [];

  const { data, error } = await supabase
    .from(ADS_TABLE)
    .select('ad_archive_id, business_id, title, page_name, text, caption, display_format, vector_group, competitor_niche, url, cards_json')
    .eq('vector_group', vectorGroup)
    .eq('business_id', businessId)
    .neq('ad_archive_id', currentAdArchiveId)
    .order('ad_archive_id', { ascending: true })
    .limit(60); 

  if (error) return [];

  // Get group dates once for all related ads
  const groupDates = await getGroupDateRange(vectorGroup);

  return (data ?? []).map((ad: any) => ({
    id: ad.ad_archive_id,
    ad_archive_id: ad.ad_archive_id,
    business_id: ad.business_id,
    title: getEffectiveTitle(ad.title, ad.cards_json, { caption: ad.caption, text: ad.text }),
    page_name: ad.page_name,
    ad_text: ad.text ?? null,
    caption: ad.caption ?? null,
    url: ad.url ?? null,
    competitor_niche: ad.competitor_niche ?? null,
    display_format: ad.display_format,
    vector_group: ad.vector_group,
    start_date_formatted: groupDates.minStartDate,
    end_date_formatted: groupDates.maxEndDate,
    duplicates_count: ad.duplicates_count,
    image_url: undefined, // Client will resolve via getImageUrl()
    meta_ad_url: getMetaAdUrl(ad.ad_archive_id),
    raw: ad,
    created_at: new Date().toISOString(),
  }));
}

export async function fetchGroupRepresentative(vectorGroup: number, businessId: string): Promise<Ad | null> {
  if (vectorGroup === -1) return null;

  const { data, error } = await supabase
    .from(ADS_TABLE)
    .select('ad_archive_id, business_id, title, page_name, text, caption, display_format, vector_group, url, cards_json')
    .eq('vector_group', vectorGroup)
    .eq('business_id', businessId)
    .order('ad_archive_id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error?.code !== 'PGRST116') {
      console.error('Error fetching group representative:', JSON.stringify(error, null, 2));
    }
    return null;
  }

  const rowData = data as any;
  const effectiveTitle = getEffectiveTitle(rowData.title, rowData.cards_json, { caption: rowData.caption, text: rowData.text });

  const businessSlug = await getBusinessSlug(businessId);
  const creativeUrl = businessSlug ? await getCreativeUrl(rowData.ad_archive_id, businessSlug) : null;

  const groupDates = await getGroupDateRange(vectorGroup);

  return {
    id: rowData.ad_archive_id,
    ad_archive_id: rowData.ad_archive_id,
    business_id: rowData.business_id,
    title: effectiveTitle,
    ad_text: rowData.ad_text ?? rowData.text ?? null,
    caption: rowData.caption ?? rowData.cta_text ?? null,
    page_name: rowData.page_name,
    url: rowData.url ?? null,
    competitor_niche: rowData.competitor_niche ?? null,
    display_format: rowData.display_format,
    created_at: new Date().toISOString(),
    start_date_formatted: groupDates.minStartDate,
    end_date_formatted: groupDates.maxEndDate,
    vector_group: vectorGroup,
    duplicates_count: rowData.duplicates_count,
    meta_ad_url: getMetaAdUrl(rowData.ad_archive_id),
    image_url: creativeUrl ?? undefined,
  };
}

export async function fetchPageNames(businessId: string): Promise<{ name: string; count: number }[]> {
  const cacheKey = `pagenames_${businessId}`;
  const t = nowMs();
  const cached = pageNamesCacheMap.get(cacheKey);
  if (cached && t - cached.time < CACHE_DURATION) {
    return cached.data;
  }

  // Fetch a capped set and aggregate client-side (Supabase JS lacks group helper here)
  const { data, error } = await supabase
    .from(ADS_TABLE)
    .select('page_name')
    .eq('business_id', businessId)
    .not('vector_group', 'is', null)
    .neq('vector_group', -1)
    .limit(50000);

  if (error) {
    console.error('Error fetching page names:', JSON.stringify(error, null, 2));
    return [];
  }

  const map = new Map<string, number>();
  for (const row of data || []) {
    const name = row.page_name || '';
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + 1);
  }

  const result = Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  pageNamesCacheMap.set(cacheKey, { data: result, time: nowMs() });
  return result;
}