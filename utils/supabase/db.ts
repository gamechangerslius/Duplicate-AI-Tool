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

    // Build filters to query ads_groups_test directly and paginate there.
    // Determine rep ad ids that match displayFormat / date filters (if provided)
    let allowedRepIds: string[] | null = null;
    if (filters?.displayFormat || filters?.startDate || filters?.endDate) {
      let q = supabase.from(ADS_TABLE).select('ad_archive_id').eq('business_id', filters.businessId);
      if (filters.displayFormat) q = q.eq('display_format', filters.displayFormat);
      if (filters.startDate) q = q.gte('start_date_formatted', filters.startDate);
      if (filters.endDate) q = q.lte('end_date_formatted', filters.endDate);
      const { data: repRows } = await q;
      allowedRepIds = (repRows || []).map(r => r.ad_archive_id).filter(Boolean);
      if (allowedRepIds.length === 0) {
        // no groups match the rep filters
        return { ads: [], total: 0 };
      }
    }

    // AI description filter: find matching vector_group ids first
    let matchingVectorGroups: number[] | null = null;
    if (filters?.aiDescription) {
      const descTerm = `%${filters.aiDescription}%`;
      const { data: statusRows } = await supabase
        .from(ADS_GROUPS_STATUS_VIEW)
        .select('vector_group')
        .ilike('ai_description', descTerm);
      matchingVectorGroups = (statusRows || []).map((r: any) => r.vector_group).filter(Boolean);
      if (matchingVectorGroups.length === 0) return { ads: [], total: 0 };
    }

    // Duplicates range: use `items` column directly (ads_groups_test is authoritative)
    // Allow showing groups with 1 duplicate by default (min = 1)
    const minDup = Math.max(filters?.duplicatesRange?.min ?? 1, 1);
    const maxDup = filters?.duplicatesRange?.max ?? Number.MAX_SAFE_INTEGER;

    // Count total matching groups using head query for pagination
    let countQ: any = supabase.from(ADS_GROUPS_TABLE).select('vector_group', { count: 'exact', head: true }).eq('business_id', filters.businessId);
    if (allowedRepIds) countQ = countQ.in('rep_ad_archive_id', allowedRepIds as any);
    if (matchingVectorGroups) countQ = countQ.in('vector_group', matchingVectorGroups as any);
    countQ = countQ.gte('items', minDup);
    if (Number.isFinite(maxDup) && maxDup < Number.MAX_SAFE_INTEGER) countQ = countQ.lte('items', maxDup);
    const countRes: any = await countQ;
    const total = (countRes && (countRes.count ?? 0)) || 0;

    if (total === 0) {
      return { ads: [], total: 0 };
    }

    // Fetch paginated groups ordered by `items` desc (largest groups first)
    const start = (page - 1) * perPage;
    const end = page * perPage - 1;
    let groupsQ: any = supabase.from(ADS_GROUPS_TABLE).select('vector_group, items, rep_ad_archive_id').eq('business_id', filters.businessId);
    if (allowedRepIds) groupsQ = groupsQ.in('rep_ad_archive_id', allowedRepIds as any);
    if (matchingVectorGroups) groupsQ = groupsQ.in('vector_group', matchingVectorGroups as any);
    groupsQ = groupsQ.gte('items', minDup);
    if (Number.isFinite(maxDup) && maxDup < Number.MAX_SAFE_INTEGER) groupsQ = groupsQ.lte('items', maxDup);
    groupsQ = groupsQ.order('items', { ascending: false });
    const { data: pageGroups } = await groupsQ.range(start, end as any);
    if (!pageGroups || pageGroups.length === 0) return { ads: [], total };

    const pageRepIds = pageGroups.map((g: any) => g.rep_ad_archive_id).filter(Boolean);

    const [repAdsRes, statusRes, businessRes] = await Promise.all([
      supabase.from(ADS_TABLE).select('*').in('ad_archive_id', pageRepIds),
      supabase.from(ADS_GROUPS_STATUS_VIEW).select('*').in('vector_group', pageGroups.map((g: any) => g.vector_group)),
      supabase.from('businesses').select('slug').eq('id', filters.businessId).single()
    ]);

    const repMap = new Map(repAdsRes.data?.map((r: any) => [r.ad_archive_id, r]));
    const statusMap = new Map(statusRes.data?.map((s: any) => [s.vector_group, s]));
    const slug = businessRes.data?.slug;

    // Compute per-group date range for returned page groups
    const groupVectorIds = pageGroups.map((g: any) => g.vector_group).filter((v: any) => typeof v !== 'undefined' && v !== null);
    let globalDatesMap = new Map<string, { minStartDate: string | null; maxEndDate: string | null }>();
    if (groupVectorIds.length > 0) {
      try {
        let q = supabase
          .from(ADS_TABLE)
          .select('vector_group, start_date_formatted, end_date_formatted')
          .in('vector_group', groupVectorIds as any);
        if (filters?.businessId) q = q.eq('business_id', filters.businessId);
        const { data: groupRows } = await q;
        if (groupRows) {
          const dateTmp = new Map<string, { minStartDate: string | null; maxEndDate: string | null }>();
          groupRows.forEach((row: any) => {
            const vg = String(row.vector_group);
            const s = row.start_date_formatted || null;
            const e = row.end_date_formatted || null;
            const cur = dateTmp.get(vg) || { minStartDate: null, maxEndDate: null };
            if (s) {
              if (!cur.minStartDate) cur.minStartDate = s;
              else if (new Date(s).getTime() < new Date(cur.minStartDate).getTime()) cur.minStartDate = s;
            }
            if (e) {
              if (!cur.maxEndDate) cur.maxEndDate = e;
              else if (new Date(e).getTime() > new Date(cur.maxEndDate).getTime()) cur.maxEndDate = e;
            }
            dateTmp.set(vg, cur);
          });
          dateTmp.forEach((v, k) => globalDatesMap.set(k, v));
        }
      } catch (err) {
        console.error('fetchAds: failed to fetch group date ranges', err);
      }
    }

    const ads: Ad[] = [];
    for (const g of pageGroups) {
      const rep = repMap.get(g.rep_ad_archive_id);
      if (!rep) continue;

      const status = statusMap.get(g.vector_group);
      const imageUrl = await getCreativeUrl(rep.ad_archive_id, slug);

      const authoritativeItems = typeof g.items !== 'undefined' ? Number(g.items) : null;
      ads.push({
        ...rep,
        id: rep.ad_archive_id,
        group_status: status?.status || 'Stable',
        duplicates_count: authoritativeItems !== null ? Number(authoritativeItems) : undefined,
        items: authoritativeItems !== null ? Number(authoritativeItems) : undefined,
        group_items: typeof g.items !== 'undefined' ? Number(g.items) : undefined,
        group_first_seen: globalDatesMap.get(String(g.vector_group))?.minStartDate || null,
        group_last_seen: globalDatesMap.get(String(g.vector_group))?.maxEndDate || null,
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

  // Read authoritative `items` from `ads_groups_test` for this business/vector_group
  let itemsCount: number | null = null;
  try {
    if (data.vector_group !== null && typeof data.vector_group !== 'undefined') {
      const { data: groupRow, error: gerr } = await supabase
        .from(ADS_GROUPS_TABLE)
        .select('items')
        .eq('vector_group', data.vector_group)
        .eq('business_id', businessId || data.business_id)
        .maybeSingle();
      if (!gerr && groupRow?.items != null) itemsCount = Number(groupRow.items);
    }
  } catch (err) {
    console.error('fetchAdByArchiveId: failed to read group items', err);
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
    // Compute min/max using small, ordered queries to avoid loading entire table
    const { data: maxRow, error: maxErr } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('items')
      .eq('business_id', businessId)
      .order('items', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: minRow, error: minErr } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('items')
      .eq('business_id', businessId)
      .order('items', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (maxErr || minErr) return { min: 0, max: 0 };

    const max = maxRow && typeof maxRow.items !== 'undefined' && maxRow.items !== null ? Number(maxRow.items) : 0;
    const min = minRow && typeof minRow.items !== 'undefined' && minRow.items !== null ? Number(minRow.items) : 0;
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