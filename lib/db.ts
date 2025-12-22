import { supabase } from './supabase';
import type { Ad } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const BUCKET_NAME = 'test2';

// Cache for pageNames
let pageNamesCache: { name: string; count: number }[] | null = null;
let pageNamesCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get image URL from Supabase Storage
 */
export function getImageUrl(adArchiveId: string): string {
  // Try both png and jpeg extensions
  const pngUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${adArchiveId}.png`;
  return pngUrl;
}

/**
 * Get Meta Ad Library URL
 */
export function getMetaAdUrl(adArchiveId: string): string {
  return `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
}

/**
 * Fetch all ads with vector_group != null
 * Returns only the first ad from each vector_group
 */
export async function fetchAds(
  filters?: {
    business?: string;
    pageName?: string;
    duplicatesRange?: { min: number; max: number };
  },
  pagination?: {
    page: number;
    perPage: number;
  }
): Promise<{ ads: Ad[]; total: number }> {
  try {
    // Select only needed fields to reduce network load
    let query = supabase
      .from('data_base')
      .select('ad_archive_id, title, page_name, text, caption, display_format, vector_group')
      .not('vector_group', 'is', null)
      .range(0, 999999); // fetch all rows (Supabase default limit is 1000)

    // Apply filters
    if (filters?.pageName) {
      query = query.eq('page_name', filters.pageName);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching ads:', JSON.stringify(error, null, 2));
      return { ads: [], total: 0 };
    }

    if (!data || data.length === 0) {
      console.log('No ads found with current filters');
      return { ads: [], total: 0 };
    }

    // Count items in each group
    const groupCountMap = new Map<number, number>();
    for (const ad of data) {
      if (ad.vector_group === -1) continue; // Skip unique ads
      const count = groupCountMap.get(ad.vector_group) || 0;
      groupCountMap.set(ad.vector_group, count + 1);
    }

    // Group by vector_group and take first from each group
    const groupMap = new Map<number, Ad>();
    
    for (const ad of data) {
      if (ad.vector_group === -1) continue; // Skip unique ads
      
      if (!groupMap.has(ad.vector_group)) {
        const duplicatesCount = groupCountMap.get(ad.vector_group) || 0;
        groupMap.set(ad.vector_group, {
          id: ad.ad_archive_id, // Use ad_archive_id as id
          ad_archive_id: ad.ad_archive_id,
          title: ad.title,
          page_name: ad.page_name,
          ad_text: (ad as any).ad_text ?? (ad as any).text ?? null,
          caption: (ad as any).caption ?? (ad as any).cta_text ?? null,
          display_format: ad.display_format,
          created_at: new Date().toISOString(),
          vector_group: ad.vector_group,
          duplicates_count: duplicatesCount,
          meta_ad_url: getMetaAdUrl(ad.ad_archive_id),
        });
      }
    }

    let result = Array.from(groupMap.values());
    
    // Apply duplicates filter on calculated counts
    if (filters?.duplicatesRange) {
      const { min, max } = filters.duplicatesRange;
      result = result.filter(ad => {
        const count = ad.duplicates_count || 0;
        if (max === Infinity) {
          return count >= min;
        } else {
          return count >= min && count <= max;
        }
      });
    }
    
    const total = result.length;

    // Sort by duplicates_count descending (highest first)
    result.sort((a, b) => {
      const countA = a.duplicates_count || 0;
      const countB = b.duplicates_count || 0;
      return countB - countA;
    });

    console.log('Top 5 groups after sorting:', result.slice(0, 5).map(ad => ({ 
      group: ad.vector_group, 
      duplicates: ad.duplicates_count 
    })));

    // Apply pagination
    if (pagination) {
      const { page, perPage } = pagination;
      const start = (page - 1) * perPage;
      const end = start + perPage;
      result = result.slice(start, end);
    }

    console.log(`Fetched ${result.length} unique ad groups from ${data.length} total ads, total groups: ${total}`);
    return { ads: result, total };
  } catch (err) {
    console.error('Exception in fetchAds:', err);
    return { ads: [], total: 0 };
  }
}

/**
 * Fetch a single ad by ad_archive_id
 */
export async function fetchAdByArchiveId(adArchiveId: string): Promise<Ad | null> {
  const { data, error } = await supabase
    .from('data_base')
    .select('*')
    .eq('ad_archive_id', adArchiveId)
    .single();

  if (error || !data) {
    console.error('Error fetching ad:', JSON.stringify(error, null, 2));
    return null;
  }

  const { embedding_vec, ...raw } = data;

  return {
    id: data.ad_archive_id, // Use ad_archive_id as id
    ad_archive_id: data.ad_archive_id,
    title: data.title,
    page_name: data.page_name,
    ad_text: data.ad_text ?? data.text ?? null,
    caption: data.caption ?? data.cta_text ?? null,
    display_format: data.display_format,
    created_at: data.created_at || new Date().toISOString(),
    vector_group: data.vector_group,
    duplicates_count: data.duplicates_count,
    meta_ad_url: getMetaAdUrl(data.ad_archive_id),
    raw,
  };
}

/**
 * Fetch a single ad by ID (legacy support)
 */
export async function fetchAdById(id: string): Promise<Ad | null> {
  const { data, error } = await supabase
    .from('data_base')
    .select('*')
    .eq('ad_archive_id', id)
    .single();

  if (error || !data) {
    console.error('Error fetching ad:', JSON.stringify(error, null, 2));
    return null;
  }

  const { embedding_vec, ...raw } = data;

  return {
    id: data.ad_archive_id, // Use ad_archive_id as id
    ad_archive_id: data.ad_archive_id,
    title: data.title,
    page_name: data.page_name,
    ad_text: data.ad_text ?? data.text ?? null,
    caption: data.caption ?? data.cta_text ?? null,
    display_format: data.display_format,
    created_at: data.created_at || new Date().toISOString(),
    vector_group: data.vector_group,
    duplicates_count: data.duplicates_count,
    meta_ad_url: getMetaAdUrl(data.ad_archive_id),
    raw,
  };
}

/**
 * Fetch all ads from the same vector_group (excluding the current ad)
 */
export async function fetchRelatedAds(vectorGroup: number, currentAdArchiveId: string): Promise<Ad[]> {
  if (vectorGroup === -1) {
    return []; // No related ads for unique creatives
  }

  const { data, error } = await supabase
    .from('data_base')
    .select('*')
    .eq('vector_group', vectorGroup)
    .neq('ad_archive_id', currentAdArchiveId);

  if (error) {
    console.error('Error fetching related ads:', JSON.stringify(error, null, 2));
    return [];
  }

  return (data || []).map((ad) => {
    const { embedding_vec, ...raw } = ad;
    return {
      id: ad.ad_archive_id, // Use ad_archive_id as id
      ad_archive_id: ad.ad_archive_id,
      title: ad.title,
      page_name: ad.page_name,
      ad_text: (ad as any).ad_text ?? (ad as any).text ?? null,
      caption: (ad as any).caption ?? (ad as any).cta_text ?? null,
      display_format: ad.display_format,
      created_at: ad.created_at || new Date().toISOString(),
      vector_group: ad.vector_group,
      duplicates_count: ad.duplicates_count,
      meta_ad_url: getMetaAdUrl(ad.ad_archive_id),
      raw,
    };
  });
}

/**
 * Fetch a deterministic representative ad for the given vector_group
 * Strategy: the ad with the smallest ad_archive_id in the group
 */
export async function fetchGroupRepresentative(vectorGroup: number): Promise<Ad | null> {
  if (vectorGroup === -1) return null;

  const { data, error } = await supabase
    .from('data_base')
    .select('*')
    .eq('vector_group', vectorGroup)
    .order('ad_archive_id', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    console.error('Error fetching group representative:', JSON.stringify(error, null, 2));
    return null;
  }

  const { embedding_vec, ...raw } = data;

  return {
    id: data.ad_archive_id,
    ad_archive_id: data.ad_archive_id,
    title: data.title,
    ad_text: data.ad_text ?? data.text ?? null,
    caption: data.caption ?? data.cta_text ?? null,
    page_name: data.page_name,
    display_format: data.display_format,
    created_at: data.created_at || new Date().toISOString(),
    vector_group: data.vector_group,
    duplicates_count: data.duplicates_count,
    meta_ad_url: getMetaAdUrl(data.ad_archive_id),
    raw,
  };
}

/**
 * Fetch full raw row by ad_archive_id (all columns)
 */
export async function fetchAdRawByArchiveId(adArchiveId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('data_base')
    .select('*')
    .eq('ad_archive_id', adArchiveId)
    .single();

  if (error || !data) {
    console.error('Error fetching raw ad:', JSON.stringify(error, null, 2));
    return null;
  }
  return data as Record<string, any>;
}

/**
 * Fetch full raw representative row for a vector_group
 */
export async function fetchGroupRepresentativeRaw(vectorGroup: number): Promise<Record<string, any> | null> {
  if (vectorGroup === -1) return null;

  const { data, error } = await supabase
    .from('data_base')
    .select('*')
    .eq('vector_group', vectorGroup)
    .order('ad_archive_id', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    console.error('Error fetching raw group representative:', JSON.stringify(error, null, 2));
    return null;
  }
  return data as Record<string, any>;
}

/**
 * Get unique page names with count of unique creatives (cached)
 */
export async function fetchPageNames(): Promise<{ name: string; count: number }[]> {
  const now = Date.now();
  if (pageNamesCache && (now - pageNamesCacheTime) < CACHE_DURATION) {
    console.log('Using cached pageNames');
    return pageNamesCache;
  }

  const { data, error } = await supabase
    .from('data_base')
    .select('page_name, vector_group')
    .not('vector_group', 'is', null)
    .neq('vector_group', -1);

  if (error) {
    console.error('Error fetching page names:', error);
    return [];
  }

  // Count unique vector groups per page
  const pageMap = new Map<string, Set<number>>();
  
  for (const row of (data || [])) {
    if (!pageMap.has(row.page_name)) {
      pageMap.set(row.page_name, new Set());
    }
    pageMap.get(row.page_name)!.add(row.vector_group);
  }

  const result = Array.from(pageMap.entries())
    .map(([name, groups]) => ({
      name,
      count: groups.size,
    }))
    .sort((a, b) => b.count - a.count);

  // Update cache
  pageNamesCache = result;
  pageNamesCacheTime = Date.now();
  
  return result;
}
