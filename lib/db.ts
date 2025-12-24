import { supabase } from './supabase';
import type { Ad } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const HEADWAY_TABLE = 'duplicate_2data_base_blinkist';
const HOLYWATER_TABLE = 'data_base';
const HEADWAY_BUCKET = 'blinkist2';
const HOLYWATER_BUCKET = 'test2';

// Cache for pageNames (per table)
const pageNamesCacheMap = new Map<string, { data: { name: string; count: number }[]; time: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Get image URL from Supabase Storage
export function getImageUrl(adArchiveId: string, bucket: string = HOLYWATER_BUCKET): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${adArchiveId}.png`;
}

// Get Meta Ad Library URL
export function getMetaAdUrl(adArchiveId: string): string {
  return `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
}

// Fetch all ads with vector_group != null. Returns first ad of each group.
export async function fetchAds(
  filters?: {
    business?: string;
    pageName?: string;
    duplicatesRange?: { min: number; max: number };
    competitorNiche?: string;
  },
  pagination?: { page: number; perPage: number }
): Promise<{ ads: Ad[]; total: number }> {
  try {
    const BATCH_SIZE = 250;
    const rows: any[] = [];
    let lastId: string | null = null; // keyset pagination cursor
    const isHeadway = (filters?.business || '').toLowerCase() === 'headway';
    const table = isHeadway ? HEADWAY_TABLE : HOLYWATER_TABLE;
    const bucket = isHeadway ? HEADWAY_BUCKET : HOLYWATER_BUCKET;

    const buildQuery = () => {
      let q = supabase
        .from(table)
        .select(
          isHeadway
            ? 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, url'
            : 'ad_archive_id, title, page_name, text, caption, display_format, vector_group, competitor_niche, url'
        )
        .not('vector_group', 'is', null)
        .neq('vector_group', -1)
        .order('ad_archive_id', { ascending: true })
        .limit(BATCH_SIZE);

      if (lastId) {
        q = q.gt('ad_archive_id', lastId);
      }
      if (filters?.pageName) {
        q = q.eq('page_name', filters.pageName);
      }
      if (!isHeadway && filters?.competitorNiche) {
        const normalized = filters.competitorNiche.trim().toLowerCase();
        q = q.eq('competitor_niche', normalized);
      }
      return q;
    };

    while (true) {
      const { data, error } = await buildQuery();
      if (error) {
        console.error('Error fetching ads:', JSON.stringify(error, null, 2));
        return { ads: [], total: 0 };
      }
      const batch = (data || []) as any[];
      if (batch.length === 0) break;
      rows.push(...batch);
      lastId = batch[batch.length - 1].ad_archive_id as string;
      if (batch.length < BATCH_SIZE) break;
    }

    if (rows.length === 0) return { ads: [], total: 0 };

    // Count items in each group
    const groupCount = new Map<number, number>();
    for (const row of rows) {
      const vg = row.vector_group;
      if (vg === -1 || vg == null) continue;
      groupCount.set(vg, (groupCount.get(vg) || 0) + 1);
    }

    // Take first row from each group and attach duplicates_count
    const byGroup = new Map<number, Ad>();
    for (const row of rows) {
      const vg = row.vector_group;
      if (vg === -1 || vg == null) continue;
      if (!byGroup.has(vg)) {
        byGroup.set(vg, {
          id: row.ad_archive_id,
          ad_archive_id: row.ad_archive_id,
          title: row.title,
          page_name: row.page_name,
          ad_text: (row as any).ad_text ?? (row as any).text ?? null,
          caption: (row as any).caption ?? (row as any).cta_text ?? null,
          url: (row as any).url ?? null,
          competitor_niche: (row as any).competitor_niche ?? null,
          display_format: row.display_format,
          created_at: new Date().toISOString(),
          vector_group: vg,
          duplicates_count: groupCount.get(vg) || 0,
          meta_ad_url: getMetaAdUrl(row.ad_archive_id),
          image_url: getImageUrl(row.ad_archive_id, bucket),
        });
      }
    }

    let result = Array.from(byGroup.values());

    if (filters?.duplicatesRange) {
      const { min, max } = filters.duplicatesRange;
      result = result.filter(a => {
        const c = a.duplicates_count || 0;
        return max === Infinity ? c >= min : c >= min && c <= max;
      });
    }

    const total = result.length;
    result.sort((a, b) => (b.duplicates_count || 0) - (a.duplicates_count || 0));

    if (pagination) {
      const { page, perPage } = pagination;
      const start = (page - 1) * perPage;
      result = result.slice(start, start + perPage);
    }

    return { ads: result, total };
  } catch (err) {
    console.error('Exception in fetchAds:', err);
    return { ads: [], total: 0 };
  }
}

// Fetch a single ad by ad_archive_id
export async function fetchAdByArchiveId(adArchiveId: string): Promise<Ad | null> {
  // Try Holywater first, then Headway
  const tryTables = [HOLYWATER_TABLE, HEADWAY_TABLE];
  for (const table of tryTables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('ad_archive_id', adArchiveId)
      .single();

    if (error || !data) {
      if (error?.code !== 'PGRST116') {
        console.warn(`Fetch ad from ${table} failed:`, JSON.stringify(error, null, 2));
      }
      continue;
    }

    const { embedding_vec, ...raw } = data as any;
    (raw as any).__table = table;
    const bucket = table === HEADWAY_TABLE ? HEADWAY_BUCKET : HOLYWATER_BUCKET;
    return {
      id: data.ad_archive_id,
      ad_archive_id: data.ad_archive_id,
      title: data.title,
      page_name: data.page_name,
      ad_text: (data as any).ad_text ?? (data as any).text ?? null,
      caption: (data as any).caption ?? (data as any).cta_text ?? null,
      url: (data as any).url ?? null,
      display_format: data.display_format,
      created_at: (data as any).created_at || new Date().toISOString(),
      vector_group: data.vector_group,
      meta_ad_url: getMetaAdUrl(data.ad_archive_id),
      image_url: getImageUrl(data.ad_archive_id, bucket),
      raw,
    };
  }
  return null;
}

// Fetch a single ad by ID (legacy support)
export async function fetchAdById(id: string): Promise<Ad | null> {
  return fetchAdByArchiveId(id);
}

// Fetch all ads from same vector_group excluding current
export async function fetchRelatedAds(vectorGroup: number, currentAdArchiveId: string, tableName: string = HOLYWATER_TABLE): Promise<Ad[]> {
  if (vectorGroup === -1) return [];

  const bucket = tableName === HEADWAY_TABLE ? HEADWAY_BUCKET : HOLYWATER_BUCKET;

  const { data, error } = await supabase
    .from(tableName)
    .select('ad_archive_id, title, page_name, text, caption, display_format, vector_group, url')
    .eq('vector_group', vectorGroup)
    .neq('ad_archive_id', currentAdArchiveId)
    .order('ad_archive_id', { ascending: true })
    .limit(500);

  if (error) {
    console.error('Error fetching related ads:', JSON.stringify(error, null, 2));
    return [];
  }

  return (data || []).map((ad: any) => {
    const { embedding_vec, ...raw } = ad;
    return {
      id: ad.ad_archive_id,
      ad_archive_id: ad.ad_archive_id,
      title: ad.title,
      page_name: ad.page_name,
      ad_text: ad.ad_text ?? ad.text ?? null,
      caption: ad.caption ?? ad.cta_text ?? null,
      url: (ad as any).url ?? null,
      display_format: ad.display_format,
      created_at: new Date().toISOString(),
      vector_group: ad.vector_group,
      meta_ad_url: getMetaAdUrl(ad.ad_archive_id),
      image_url: getImageUrl(ad.ad_archive_id, bucket),
      raw,
    };
  });
}

// Deterministic representative: smallest ad_archive_id in group
export async function fetchGroupRepresentative(vectorGroup: number, tableName: string = HOLYWATER_TABLE): Promise<Ad | null> {
  if (vectorGroup === -1) return null;

  const bucket = tableName === HEADWAY_TABLE ? HEADWAY_BUCKET : HOLYWATER_BUCKET;

  const { data, error } = await supabase
    .from(tableName)
    .select('*')
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

  const { embedding_vec, ...raw } = data as any;
  return {
    id: data.ad_archive_id,
    ad_archive_id: data.ad_archive_id,
    title: data.title,
    ad_text: (data as any).ad_text ?? (data as any).text ?? null,
    caption: (data as any).caption ?? (data as any).cta_text ?? null,
    page_name: data.page_name,
    url: (data as any).url ?? null,
    display_format: data.display_format,
    created_at: data.created_at || new Date().toISOString(),
    vector_group: data.vector_group,
    duplicates_count: data.duplicates_count,
    meta_ad_url: getMetaAdUrl(data.ad_archive_id),
    image_url: getImageUrl(data.ad_archive_id, bucket),
    raw,
  };
}

// Fetch full raw row by ad_archive_id
export async function fetchAdRawByArchiveId(adArchiveId: string, tableName: string = HOLYWATER_TABLE): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('ad_archive_id', adArchiveId)
    .single();

  if (error || !data) {
    if (error?.code !== 'PGRST116') {
      console.error('Error fetching raw ad:', JSON.stringify(error, null, 2));
    }
    return null;
  }
  return data as Record<string, any>;
}

// Fetch full raw representative row for a vector_group
export async function fetchGroupRepresentativeRaw(vectorGroup: number, tableName: string = HOLYWATER_TABLE): Promise<Record<string, any> | null> {
  if (vectorGroup === -1) return null;

  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('vector_group', vectorGroup)
    .order('ad_archive_id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error?.code !== 'PGRST116') {
      console.error('Error fetching raw group representative:', JSON.stringify(error, null, 2));
    }
    return null;
  }
  return data as Record<string, any>;
}

// Get unique page names with count of unique creatives (cached per table)
export async function fetchPageNames(tableName: string = HOLYWATER_TABLE): Promise<{ name: string; count: number }[]> {
  const now = Date.now();
  const cached = pageNamesCacheMap.get(tableName);
  if (cached && (now - cached.time) < CACHE_DURATION) {
    return cached.data;
  }

  const { data, error } = await supabase
    .from(tableName)
    .select('page_name, vector_group')
    .not('vector_group', 'is', null)
    .neq('vector_group', -1);

  if (error) {
    console.error('Error fetching page names:', JSON.stringify(error, null, 2));
    return [];
  }

  const pageMap = new Map<string, Set<number>>();
  for (const row of (data || [])) {
    if (!pageMap.has(row.page_name)) {
      pageMap.set(row.page_name, new Set());
    }
    pageMap.get(row.page_name)!.add(row.vector_group as number);
  }

  const result = Array.from(pageMap.entries())
    .map(([name, groups]) => ({ name, count: groups.size }))
    .sort((a, b) => b.count - a.count);

  pageNamesCacheMap.set(tableName, { data: result, time: Date.now() });
  return result;
}
