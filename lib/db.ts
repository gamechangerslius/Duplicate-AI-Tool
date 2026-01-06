import { supabase } from './supabase';
import type { Ad } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const HEADWAY_TABLE = 'duplicate_2data_base_blinkist';
const HOLYWATER_TABLE = 'data_base';
const HEADWAY_BUCKET = 'blinkist2';
const HOLYWATER_BUCKET = 'test2';
// Default page size used when pagination does not specify one
const PER_PAGE = 24;

const HEADWAY_FOLDER = '';   // <- set if needed
const HOLYWATER_FOLDER = ''; // <- set if needed
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

function nowMs() {
  return Date.now();
}

function normalizeBusiness(business?: string) {
  return (business || '').trim().toLowerCase();
}

function isHeadwayBusiness(business?: string) {
  return normalizeBusiness(business) === 'headway';
}

function normalizeNiche(niche?: string) {
  const s = (niche || '').trim().toLowerCase();
  return s || '';
}

export async function getCreativeUrl(
  adArchiveId: string,
  bucket: string,
  opts?: {
    folder?: string;
    preferredExts?: string[];
    signedUrlTtlSeconds?: number;
  }
): Promise<string | null> {
  const folder = (opts?.folder ?? '').replace(/^\/+|\/+$/g, '');
  const exts = opts?.preferredExts ?? ['png', 'jpg', 'jpeg'];
  const ttl = opts?.signedUrlTtlSeconds ?? 3600;

  const cacheKey = `${bucket}|${folder}|${adArchiveId}`;
  const cached = creativeUrlCache.get(cacheKey);
  const t = nowMs();
  if (cached && t - cached.time < CREATIVE_URL_CACHE_MS) return cached.url;

  const storage = supabase.storage.from(bucket);

  // Fast path: try standard "<id>.<ext>" candidates
  for (const ext of exts) {
    const fileName = `${adArchiveId}.${ext}`;
    const path = folder ? `${folder}/${fileName}` : fileName;

    // 1) Try public URL (works only if bucket is public)
    const pub = storage.getPublicUrl(path);
    const publicUrl = pub?.data?.publicUrl || null;

    // Validate existence with HEAD to avoid broken images.
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

    // 2) Signed URL fallback (works for private buckets too)
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

  // Slow fallback: list() in folder and try to find a matching file
  try {
    const { data: files, error } = await supabase.storage
      .from(bucket)
      .list(folder || undefined, { limit: 1000, search: adArchiveId });

    if (!error && files?.length) {
      const match = files.find((f) => {
        const n = f.name || '';
        if (n === `${adArchiveId}.png`) return true;
        if (n === `${adArchiveId}.jpg`) return true;
        if (n === `${adArchiveId}.jpeg`) return true;
        if (n === `${adArchiveId}.webp`) return true;
        // sometimes stored like "<id>_1.png"
        return n.startsWith(adArchiveId);
      });

      if (match?.name) {
        const path = folder ? `${folder}/${match.name}` : match.name;

        // Prefer public if possible
        const pub = supabase.storage.from(bucket).getPublicUrl(path);
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

        const { data: signed, error: e2 } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, ttl);

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

// Try multiple candidate folders for a business to resolve image URLs more reliably
async function resolveCreativeUrlForBusiness(
  adArchiveId: string,
  isHeadway: boolean
): Promise<string | undefined> {
  const bucket = isHeadway ? HEADWAY_BUCKET : HOLYWATER_BUCKET;
  const primaryFolder = isHeadway ? HEADWAY_FOLDER : HOLYWATER_FOLDER;
  const candidates = Array.from(
    new Set([
      primaryFolder,
      isHeadway ? 'headway' : '',
      ''
    ])
  );
  for (const folder of candidates) {
    const url = await getCreativeUrl(adArchiveId, bucket, {
      folder,
      preferredExts: isHeadway ? ['jpg', 'jpeg', 'png', 'webp'] : ['png', 'jpg', 'jpeg', 'webp'],
      signedUrlTtlSeconds: 3600,
    });
    if (url) return url;
  }
  return undefined;
}

/**
 * Backward-compatible helper (sync-like signature) for places you still call getImageUrl().
 * NOTE: This returns a best-effort public URL for .png only (old behavior).
 * Prefer getCreativeUrl() in new code.
 */
export function getImageUrl(adArchiveId: string, bucket: string = HOLYWATER_BUCKET): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${adArchiveId}.png`;
}

// Get Meta Ad Library URL
export function getMetaAdUrl(adArchiveId: string): string {
  return `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
}

// Extract title from cards JSON
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
async function getGroupDateRange(vectorGroup: number, tableName: string): Promise<{ minStartDate: string | null; maxEndDate: string | null }> {
  if (vectorGroup === -1 || vectorGroup == null) {
    return { minStartDate: null, maxEndDate: null };
  }

  const cacheKey = `${tableName}|${vectorGroup}`;
  const cached = groupDateRangeCache.get(cacheKey);
  const t = nowMs();
  if (cached && t - cached.time < GROUP_DATE_CACHE_MS) {
    console.log(`✅ Cache hit for group ${vectorGroup}: ${cached.data.minStartDate} to ${cached.data.maxEndDate}`);
    return cached.data;
  }

  console.log(`🔍 Fetching group dates for vector_group=${vectorGroup}, table=${tableName}`);
  
  try {
    // Use Supabase RPC function for optimized query
    const { data, error } = await supabase.rpc('get_group_date_range', { 
      target_table: tableName,
      group_id: vectorGroup
    });

    console.log(`📥 RPC result for group ${vectorGroup}:`, { data, error });

    if (error || !data || !data[0]) {
      console.warn(`Failed to fetch group dates for ${vectorGroup} from ${tableName}:`, error);
      return { minStartDate: null, maxEndDate: null };
    }

    const result = {
      minStartDate: data[0].min_start || null,
      maxEndDate: data[0].max_end || null,
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
  business?: string,
  pageName?: string,
  competitorNiche?: string,
  opts?: { startDate?: string; endDate?: string; displayFormat?: 'IMAGE' | 'VIDEO' | 'ALL' }
): Promise<{ min: number; max: number }> {
  try {
    const isHeadway = isHeadwayBusiness(business);
    const table = isHeadway ? 'v_headway_group_cards' : 'v_holywater_group_cards';

    let qMin = supabase.from(table).select('duplicates_count').order('duplicates_count', { ascending: true }).limit(1);
    let qMax = supabase.from(table).select('duplicates_count').order('duplicates_count', { ascending: false }).limit(1);

    if (pageName) {
      qMin = qMin.eq('page_name', pageName);
      qMax = qMax.eq('page_name', pageName);
    }

    if (!isHeadway && competitorNiche) {
      const niche = normalizeNiche(competitorNiche);
      if (niche) {
        qMin = qMin.eq('competitor_niche', niche);
        qMax = qMax.eq('competitor_niche', niche);
      }
    }

    if (opts?.startDate) {
      qMin = qMin.gte('start_date_formatted', opts.startDate);
      qMax = qMax.gte('start_date_formatted', opts.startDate);
    }

    if (opts?.endDate) {
      qMin = qMin.lte('end_date_formatted', opts.endDate);
      qMax = qMax.lte('end_date_formatted', opts.endDate);
    }

    if (opts?.displayFormat && opts.displayFormat !== 'ALL') {
      qMin = qMin.eq('display_format', opts.displayFormat);
      qMax = qMax.eq('display_format', opts.displayFormat);
    }

    const [{ data: dMin, error: eMin }, { data: dMax, error: eMax }] = await Promise.all([qMin, qMax]);

    if (!eMin && !eMax) {
      const min = (dMin?.[0]?.duplicates_count ?? 0) as number;
      const max = (dMax?.[0]?.duplicates_count ?? 0) as number;
      return { min, max: Math.max(min, max) };
    }

    // Fallback: compute from base tables if views are missing
    const baseTable = isHeadway ? HEADWAY_TABLE : HOLYWATER_TABLE;
    let qb = supabase
      .from(baseTable)
      .select('vector_group, display_format, start_date_formatted, end_date_formatted')
      .not('vector_group', 'is', null)
      .neq('vector_group', -1)
      .order('ad_archive_id', { ascending: true })
      .limit(200000);

    if (pageName) qb = qb.eq('page_name', pageName);
    if (!isHeadway && competitorNiche) qb = qb.eq('competitor_niche', normalizeNiche(competitorNiche));
    if (opts?.startDate) qb = qb.gte('start_date_formatted', opts.startDate);
    if (opts?.endDate) qb = qb.lte('end_date_formatted', opts.endDate);
    if (opts?.displayFormat && opts.displayFormat !== 'ALL') qb = qb.eq('display_format', opts.displayFormat);

    const { data, error } = await qb;
    if (error || !data) return { min: 0, max: 100 };
    const counts = new Map<number, number>();
    for (const row of data as any[]) {
      const vg = row.vector_group;
      if (vg === -1 || vg == null) continue;
      counts.set(vg, (counts.get(vg) || 0) + 1);
    }
    const arr = Array.from(counts.values());
    if (arr.length === 0) return { min: 0, max: 100 };
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    return { min, max };
  } catch (err) {
    console.error('Error fetching duplicates stats:', err);
    return { min: 0, max: 100 };
  }
}

export async function fetchAds(
  filters?: {
    business?: string;
    pageName?: string;
    duplicatesRange?: { min: number; max: number };
    competitorNiche?: string;
    startDate?: string;
    endDate?: string;
  },
  pagination?: { page: number; perPage: number }
): Promise<{ ads: Ad[]; total: number }> {
  try {
    const cacheKey = JSON.stringify({
      business: filters?.business,
      pageName: filters?.pageName,
      duplicatesRange: filters?.duplicatesRange,
      competitorNiche: filters?.competitorNiche,
      startDate: filters?.startDate,
      endDate: filters?.endDate,
      page: pagination?.page,
      perPage: pagination?.perPage,
      includeDates: true,
    });

    const cacheKeyWithoutDates = JSON.stringify({
      business: filters?.business,
      pageName: filters?.pageName,
      duplicatesRange: filters?.duplicatesRange,
      competitorNiche: filters?.competitorNiche,
      page: pagination?.page,
      perPage: pagination?.perPage,
      includeDates: false,
    });

    const t = nowMs();
    const cached = adsCacheMap.get(cacheKey) || adsCacheMap.get(cacheKeyWithoutDates);
    if (cached && t - cached.time < ADS_CACHE_DURATION) {
      return cached.data;
    }

    const isHeadway = isHeadwayBusiness(filters?.business);
    const table = isHeadway ? 'v_headway_group_cards' : 'v_holywater_group_cards';
    const bucket = isHeadway ? HEADWAY_BUCKET : HOLYWATER_BUCKET;
    const folder = isHeadway ? HEADWAY_FOLDER : HOLYWATER_FOLDER;

    const page = pagination?.page ?? 1;
    const perPage = pagination?.perPage ?? PER_PAGE;

    const selectFieldsWithDates = isHeadway
      ? 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, cards_json, start_date_formatted, end_date_formatted, duplicates_count'
      : 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, competitor_niche, url, cards_json, start_date_formatted, end_date_formatted, duplicates_count';

    const selectFieldsWithoutDates = isHeadway
      ? 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, cards_json, duplicates_count'
      : 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, competitor_niche, url, cards_json, duplicates_count';

    const buildQuery = (withDateFields: boolean, applyDateFilters: boolean) => {
      let query = supabase
        .from(table)
        .select(withDateFields ? selectFieldsWithDates : selectFieldsWithoutDates, { count: 'estimated' })
        .order('duplicates_count', { ascending: false })
        .range((page - 1) * perPage, page * perPage - 1);

      if (filters?.pageName) query = query.eq('page_name', filters.pageName);

      if (!isHeadway && filters?.competitorNiche) {
        const niche = normalizeNiche(filters.competitorNiche);
        if (niche) query = query.eq('competitor_niche', niche);
      }

      if (filters?.duplicatesRange) {
        query = query.gte('duplicates_count', filters.duplicatesRange.min);
        query = query.lte('duplicates_count', filters.duplicatesRange.max);
      }

      if (applyDateFilters && filters?.startDate && withDateFields) {
        query = query.gte('start_date_formatted', filters.startDate);
      }

      if (applyDateFilters && filters?.endDate && withDateFields) {
        query = query.lte('end_date_formatted', filters.endDate);
      }

      return query;
    };

    const runPrimary = () => buildQuery(true, true).then((res) => ({ ...res, withDateFields: true }));
    const runWithoutDates = async () => {
      try {
        const res = await buildQuery(false, false);
        return { ...res, withDateFields: false };
      } catch (e) {
        return { data: null, error: e as any, count: null, withDateFields: false };
      }
    };

    let { data, error, count, withDateFields } = await runPrimary();

    // Gracefully handle views missing start/end date columns by retrying without them.
    const missingDateColumns =
      error &&
      (error.message?.toLowerCase().includes('start_date_formatted') ||
        error.message?.toLowerCase().includes('end_date_formatted') ||
        error.details?.toLowerCase().includes('start_date_formatted') ||
        error.details?.toLowerCase().includes('end_date_formatted'));

    if (missingDateColumns) {
      const fallbackCacheKey = cacheKeyWithoutDates;
      const cachedWithoutDates = adsCacheMap.get(cacheKeyWithoutDates);
      if (cachedWithoutDates && t - cachedWithoutDates.time < ADS_CACHE_DURATION) {
        return cachedWithoutDates.data;
      }

      const fallback = await runWithoutDates();
      data = fallback.data;
      error = fallback.error;
      count = fallback.count;
      withDateFields = fallback.withDateFields;
    }
    if (!error && data) {
      // Resolve images (robust folders)
      const rows = data || [];
      const creativeUrls = await Promise.all(
        rows.map((row: any) => resolveCreativeUrlForBusiness(row.ad_archive_id, isHeadway))
      );
      
      // Pre-fetch all unique group dates in parallel
      // NOTE: getGroupDateRange needs base table, not view
      const baseTable = isHeadway ? HEADWAY_TABLE : HOLYWATER_TABLE;
      const groupDatesCache = new Map<number, { minStartDate: string | null; maxEndDate: string | null }>();
      const uniqueVectorGroups = [...new Set(rows.map((r: any) => r.vector_group))];
      await Promise.all(
        uniqueVectorGroups.map(async (vg) => {
          if (vg !== -1 && vg != null) {
            const dates = await getGroupDateRange(vg, baseTable);
            groupDatesCache.set(vg, dates);
          }
        })
      );
      
      const ads: Ad[] = rows.map((row: any, i: number) => {
        const effectiveTitle = getEffectiveTitle(row.title, row.cards_json, { caption: row.caption, text: row.text });
        const groupDates = groupDatesCache.get(row.vector_group) || { minStartDate: null, maxEndDate: null };
        
        return {
          id: row.ad_archive_id,
          ad_archive_id: row.ad_archive_id,
          title: effectiveTitle,
          page_name: row.page_name,
          ad_text: row.text ?? null,
          caption: row.caption ?? null,
          url: row.url ?? null,
          competitor_niche: row.competitor_niche ?? null,
          display_format: row.display_format,
          created_at: new Date().toISOString(),
          start_date_formatted: groupDates.minStartDate ?? (row as any).start_date_formatted ?? undefined,
          end_date_formatted: groupDates.maxEndDate ?? (row as any).end_date_formatted ?? undefined,
          vector_group: row.vector_group,
          duplicates_count: row.duplicates_count ?? 0,
          meta_ad_url: getMetaAdUrl(row.ad_archive_id),
          image_url: creativeUrls[i] ?? undefined,
        };
      });
      const returnValue = { ads, total: count ?? 0 };
      const cacheKeyToUse = withDateFields ? cacheKey : cacheKeyWithoutDates;
      adsCacheMap.set(cacheKeyToUse, { data: returnValue, time: nowMs() });
      return returnValue;
    }

    // Fallback: views missing — compute from base table
    const baseTable = isHeadway ? HEADWAY_TABLE : HOLYWATER_TABLE;
    let qb = supabase
      .from(baseTable)
      .select(
        isHeadway
          ? 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, cards_json'
          : 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, competitor_niche, url, cards_json'
      )
      .not('vector_group', 'is', null)
      .neq('vector_group', -1)
      .order('ad_archive_id', { ascending: true })
      .limit(200000);

    if (filters?.pageName) qb = qb.eq('page_name', filters.pageName);
    if (!isHeadway && filters?.competitorNiche) qb = qb.eq('competitor_niche', normalizeNiche(filters.competitorNiche));

    const { data: baseRows, error: baseErr } = await qb;
    if (baseErr || !baseRows) {
      console.error('Error fetching ads (view + base failed):', JSON.stringify(error || baseErr, null, 2));
      return { ads: [], total: 0 };
    }

    // Group by vector_group and compute duplicates_count
    const groupMap = new Map<number, any>();
    const counts = new Map<number, number>();
    for (const row of baseRows as any[]) {
      const vg = row.vector_group;
      if (vg === -1 || vg == null) continue;
      if (!groupMap.has(vg)) groupMap.set(vg, row); // first (smallest ad_archive_id) as representative
      counts.set(vg, (counts.get(vg) || 0) + 1);
    }

    // Apply duplicates filter
    const minDup = filters?.duplicatesRange?.min ?? 0;
    const maxDup = filters?.duplicatesRange?.max ?? Number.MAX_SAFE_INTEGER;

    const groupedRows = Array.from(groupMap.entries())
      .map(([vg, row]) => ({ ...row, vector_group: vg, duplicates_count: counts.get(vg) || 0 }))
      .filter((r) => r.duplicates_count >= minDup && r.duplicates_count <= maxDup)
      .sort((a, b) => (b.duplicates_count || 0) - (a.duplicates_count || 0));

    const total = groupedRows.length;
    const start = (page - 1) * perPage;
    const end = Math.min(start + perPage, total);
    const pageRows = groupedRows.slice(start, end);

    const creativeUrls = await Promise.all(
      pageRows.map((row: any) => resolveCreativeUrlForBusiness(row.ad_archive_id, isHeadway))
    );

    // Pre-fetch all unique group dates in parallel
    const groupDatesCache = new Map<number, { minStartDate: string | null; maxEndDate: string | null }>();
    const uniqueVectorGroups = [...new Set(pageRows.map((r: any) => r.vector_group))];
    await Promise.all(
      uniqueVectorGroups.map(async (vg) => {
        if (vg !== -1 && vg != null) {
          const dates = await getGroupDateRange(vg, baseTable);
          groupDatesCache.set(vg, dates);
        }
      })
    );

    const ads: Ad[] = pageRows.map((row: any, i: number) => {
      const effectiveTitle = getEffectiveTitle(row.title, row.cards_json, { caption: row.caption, text: row.text });
      const groupDates = groupDatesCache.get(row.vector_group) || { minStartDate: null, maxEndDate: null };
      
      return {
        id: row.ad_archive_id,
        ad_archive_id: row.ad_archive_id,
        title: effectiveTitle,
        page_name: row.page_name,
        ad_text: row.text ?? null,
        caption: row.caption ?? null,
        url: row.url ?? null,
        competitor_niche: row.competitor_niche ?? null,
        display_format: row.display_format,
        created_at: new Date().toISOString(),
        start_date_formatted: groupDates.minStartDate ?? undefined,
        end_date_formatted: groupDates.maxEndDate ?? undefined,
        vector_group: row.vector_group,
        duplicates_count: row.duplicates_count ?? 0,
        meta_ad_url: getMetaAdUrl(row.ad_archive_id),
        image_url: creativeUrls[i] ?? undefined,
      };
    });

    const returnValue = { ads, total };
    adsCacheMap.set(cacheKey, { data: returnValue, time: nowMs() });
    return returnValue;
  } catch (err) {
    console.error('Exception in fetchAds:', err);
    return { ads: [], total: 0 };
  }
}

/**
 * Fetch a single ad by ad_archive_id.
 * NOTE: Your group-card views are for gallery.
 * For the detail page we still read from base tables to get full raw record.
 */
export async function fetchAdByArchiveId(adArchiveId: string): Promise<Ad | null> {
  const tryTables = [HOLYWATER_TABLE, HEADWAY_TABLE];

  for (const table of tryTables) {
    const { data, error } = await supabase.from(table).select('*').eq('ad_archive_id', adArchiveId).single();

    if (error || !data) {
      if (error?.code !== 'PGRST116') {
        console.warn(`Fetch ad from ${table} failed:`, JSON.stringify(error, null, 2));
      }
      continue;
    }

    const isHeadway = table === HEADWAY_TABLE;
    const bucket = isHeadway ? HEADWAY_BUCKET : HOLYWATER_BUCKET;
    const folder = isHeadway ? HEADWAY_FOLDER : HOLYWATER_FOLDER;

    const effectiveTitle = getEffectiveTitle(data.title, (data as any).cards_json, { caption: (data as any).caption, text: (data as any).text });

    const creativeUrl = await getCreativeUrl(data.ad_archive_id, bucket, {
      folder,
      preferredExts: isHeadway ? ['jpg', 'jpeg', 'png', 'webp'] : ['png', 'jpg', 'jpeg', 'webp'],
      signedUrlTtlSeconds: 3600,
    });
    const resolvedUrl = creativeUrl ?? (await resolveCreativeUrlForBusiness(data.ad_archive_id, isHeadway));

    // Get group dates for the detail view
    const groupDates = await getGroupDateRange(data.vector_group, table);

    const { embedding_vec, ...raw } = data as any;
    (raw as any).__table = table;

    return {
      id: data.ad_archive_id,
      ad_archive_id: data.ad_archive_id,
      title: effectiveTitle,
      page_name: data.page_name,
      ad_text: (data as any).ad_text ?? (data as any).text ?? null,
      caption: (data as any).caption ?? (data as any).cta_text ?? null,
      url: (data as any).url ?? null,
      competitor_niche: (data as any).competitor_niche ?? null,
      display_format: data.display_format,
      created_at: (data as any).created_at || new Date().toISOString(),
      vector_group: data.vector_group,
      duplicates_count: (data as any).duplicates_count,
      meta_ad_url: getMetaAdUrl(data.ad_archive_id),
      image_url: resolvedUrl ?? undefined,
      start_date_formatted: groupDates.minStartDate ?? ((data as any).start_date_formatted ?? null),
      end_date_formatted: groupDates.maxEndDate ?? ((data as any).end_date_formatted ?? null),
      raw,
    };
  }

  return null;
}

export async function fetchAdById(id: string): Promise<Ad | null> {
  return fetchAdByArchiveId(id);
}

/**
 * Fetch related ads from same vector_group excluding current.
 * We keep this against base tables (needs all rows).
 * NOTE: Do NOT resolve storage URLs here - let client use getImageUrl() instead.
 * This avoids hundreds of HEAD/signedUrl requests during SSR.
 */
export async function fetchRelatedAds(vectorGroup: number, currentAdArchiveId: string, tableName: string): Promise<Ad[]> {
  if (vectorGroup === -1) return [];

  const { data, error } = await supabase
    .from(tableName)
    .select('ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, cards_json')
    .eq('vector_group', vectorGroup)
    .neq('ad_archive_id', currentAdArchiveId)
    .order('ad_archive_id', { ascending: true })
    .limit(60); 

  if (error) return [];

  // Get group dates once for all related ads
  const groupDates = await getGroupDateRange(vectorGroup, tableName);

  // DO NOT resolve storage URLs here - just return ad_archive_id
  // Client will use getImageUrl(ad_archive_id, bucket)
  return (data ?? []).map((ad: any) => ({
    id: ad.ad_archive_id,
    ad_archive_id: ad.ad_archive_id,
    title: getEffectiveTitle(ad.title, ad.cards_json, { caption: ad.caption, text: ad.text }),
    page_name: ad.page_name,
    ad_text: ad.text ?? null,
    caption: ad.caption ?? null,
    url: ad.url ?? null,
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

/**
 * Deterministic representative: smallest ad_archive_id in group (base table).
 * Excludes heavy fields like embedding_vec to reduce payload.
 */
export async function fetchGroupRepresentative(vectorGroup: number, tableName: string = HOLYWATER_TABLE): Promise<Ad | null> {
  if (vectorGroup === -1) return null;

  const isHeadway = tableName === HEADWAY_TABLE;
  const bucket = isHeadway ? HEADWAY_BUCKET : HOLYWATER_BUCKET;
  const folder = isHeadway ? HEADWAY_FOLDER : HOLYWATER_FOLDER;

  // Headway table doesn't have created_at column
  const selectFields = isHeadway
    ? 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, cards_json'
    : 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, cards_json, created_at';

  const { data, error } = await supabase
    .from(tableName)
    .select(selectFields)
    .eq('vector_group', vectorGroup)
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

  const creativeUrl = await getCreativeUrl(rowData.ad_archive_id, bucket, {
    folder,
    preferredExts: isHeadway ? ['jpg', 'jpeg', 'png'] : ['png', 'jpg', 'jpeg'],
    signedUrlTtlSeconds: 3600,
  });

  const groupDates = await getGroupDateRange(vectorGroup, tableName);

  return {
    id: rowData.ad_archive_id,
    ad_archive_id: rowData.ad_archive_id,
    title: effectiveTitle,
    ad_text: rowData.ad_text ?? rowData.text ?? null,
    caption: rowData.caption ?? rowData.cta_text ?? null,
    page_name: rowData.page_name,
    url: rowData.url ?? null,
    competitor_niche: rowData.competitor_niche ?? null,
    display_format: rowData.display_format,
    created_at: rowData.created_at || new Date().toISOString(),
    start_date_formatted: groupDates.minStartDate ?? (rowData.start_date_formatted ?? null),
    end_date_formatted: groupDates.maxEndDate ?? (rowData.end_date_formatted ?? null),
    vector_group: rowData.vector_group,
    duplicates_count: rowData.duplicates_count,
    meta_ad_url: getMetaAdUrl(rowData.ad_archive_id),
    image_url: creativeUrl ?? undefined,
  };
}

export async function fetchPageNames(tableName: string = HOLYWATER_TABLE): Promise<{ name: string; count: number }[]> {
  const t = nowMs();
  const cached = pageNamesCacheMap.get(tableName);
  if (cached && t - cached.time < CACHE_DURATION) {
    return cached.data;
  }

  const isHeadway = tableName === HEADWAY_TABLE;
  const view = isHeadway ? 'v_headway_group_cards' : 'v_holywater_group_cards';

  const { data, error } = await supabase
    .from(view)
    .select('page_name')
    .limit(200000); // safe-ish upper limit; view should be much smaller than base table

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

  pageNamesCacheMap.set(tableName, { data: result, time: nowMs() });
  return result;
}