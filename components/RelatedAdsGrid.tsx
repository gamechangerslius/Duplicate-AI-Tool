"use client";

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import type { Ad } from '@/lib/types';
import { getCreativeUrl } from '@/utils/supabase/db';

interface Props {
  ads: Ad[];
  groupSize: number;
  vectorGroup: number;
  currentAdArchiveId: string;
  businessId: string;
  businessSlug: string;
}

export function RelatedAdsGrid({ ads, groupSize, vectorGroup, currentAdArchiveId, businessId, businessSlug }: Props) {
  const [selected, setSelected] = useState<Ad | null>(null);
  const [items, setItems] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(ads.length ? ads[ads.length - 1].ad_archive_id : null);
  const [hasMore, setHasMore] = useState(true);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const dedupeByGroup = (list: Ad[]) => {
    // For related-ads we should not dedupe by vector_group (all items share same group).
    // Instead dedupe by ad id to remove duplicates only.
    const seen = new Set<string>();
    return list.filter((ad) => {
      const id = String(ad.ad_archive_id || ad.id || '');
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  const sortByStatus = useCallback((list: Ad[]) => {
    const priority: Record<string, number> = {
      New: 0,
      Scaling: 1,
      Inactive: 3,
      undefined: 2,
    };
    return dedupeByGroup(list).sort((a, b) => {
      const pa = priority[a.status ?? 'undefined'];
      const pb = priority[b.status ?? 'undefined'];
      if (pa !== pb) return pa - pb;
      return a.ad_archive_id.localeCompare(b.ad_archive_id);
    });
  }, []);

  const getImageSrc = (ad: Ad): string => {
    const url = ad.image_url || imageUrls[ad.ad_archive_id] || null;
    if (url && url.trim()) return url;
    return '/placeholder.png';
  };

  useEffect(() => {
    const next = sortByStatus(ads);
    setItems(next);
    setCursor(next.length ? next[next.length - 1].ad_archive_id : null);
  }, [ads, sortByStatus]);

  useEffect(() => {
    const loadImages = async () => {
      // Collect ads that need image loading
      const adsNeedingImages = items.filter(ad => !ad.image_url && !imageUrls[ad.ad_archive_id]);
      
      if (adsNeedingImages.length === 0) return;

      console.log(`[RelatedAdsGrid] Loading ${adsNeedingImages.length} images in parallel...`);
      
      // Load all images in parallel
      const imagePromises = adsNeedingImages.map(async (ad) => {
        const url = await getCreativeUrl(ad.ad_archive_id, businessSlug);
        if (url) {
          console.log(`[RelatedAdsGrid] ✓ Found image for ${ad.ad_archive_id}: ${url.substring(0, 60)}...`);
          return { adId: ad.ad_archive_id, url };
        } else {
          console.warn(`[RelatedAdsGrid] ✗ No image found for ad=${ad.ad_archive_id}`);
          return null;
        }
      });

      // Wait for all to complete and update state once
      const results = await Promise.all(imagePromises);
      const newUrls: Record<string, string> = {};
      
      results.forEach(result => {
        if (result) {
          newUrls[result.adId] = result.url;
        }
      });

      if (Object.keys(newUrls).length > 0) {
        setImageUrls(prev => ({ ...prev, ...newUrls }));
        console.log(`[RelatedAdsGrid] ✓ Loaded ${Object.keys(newUrls).length} images`);
      }
    };
    
    loadImages();
  }, [items, businessSlug, imageUrls, sortByStatus]);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ 
        vector_group: String(vectorGroup), 
        current_id: currentAdArchiveId, 
        business_id: businessId,
        limit: '60' 
      });
      if (cursor) params.set('last_id', cursor);
      const res = await fetch(`/api/related-ads?${params.toString()}`);
      const json = await res.json();
      const newItems: Ad[] = json.items || [];
      if (newItems.length > 0) {
        setItems(prev => sortByStatus([...prev, ...newItems]));
        setCursor(json.nextCursor || newItems[newItems.length - 1].ad_archive_id);
        setHasMore(Boolean(json.hasMore));
      } else {
        setHasMore(false);
      }
    } catch (e) {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {items.map((ad) => (
          <button
            key={ad.ad_archive_id}
            type="button"
            onClick={() => setSelected(ad)}
            className={`group text-left ${ad.status === 'Inactive' ? 'opacity-60 saturate-50' : ''}`}
            aria-label={`Open details for ${ad.ad_archive_id}`}
          >
            <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden">
              <div className="relative aspect-square bg-slate-100">
                <Image
                  src={getImageSrc(ad)}
                  alt={ad.title || ad.page_name}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  unoptimized
                />
                {ad.status && (
                  <div className="absolute top-2 left-2">
                    {ad.status === 'New' && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold shadow-sm">New</span>
                    )}
                    {ad.status === 'Scaling' && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold shadow-sm inline-flex items-center gap-1">
                        <span className="text-[12px]">▲</span> +{ad.diff_count ?? 0}
                      </span>
                    )}
                    {ad.status === 'Inactive' && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold shadow-sm">Inactive</span>
                    )}
                  </div>
                )}
              </div>
              <div className="px-3 py-2 border-t border-slate-200 space-y-1">
                <div className="text-xs text-slate-900 font-medium truncate" title={ad.title || 'Untitled'}>
                  {ad.title || 'Untitled'}
                </div>
                <div className="text-[11px] text-slate-600 truncate" title={ad.ad_archive_id}>
                  {ad.ad_archive_id}
                </div>
                <div className="text-[11px] text-slate-500 truncate" title={ad.start_date_formatted || undefined}> </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden">
            <div className="flex items-start gap-4 p-4 border-b border-slate-200">
              <div className="relative h-24 w-24 rounded-md overflow-hidden bg-slate-100 flex-shrink-0">
                <Image
                  src={getImageSrc(selected)}
                  alt={selected.title || selected.page_name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 font-semibold truncate">{selected.title || 'Untitled'}</div>
                <div className="text-slate-600 text-sm truncate">{selected.page_name}</div>
                <div className="text-slate-500 text-xs mt-1">Group size: {groupSize}</div>
              </div>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-700"
                onClick={() => setSelected(null)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="p-4 text-sm text-slate-900 max-h-[70vh] overflow-y-auto">
              {selected.raw && (
                <div>
                  <div className="text-slate-900 font-semibold mb-2 text-sm">Full DB Fields</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-900">
                    {Object.entries(selected.raw).map(([key, value]) => {
                      const isLink = typeof value === 'string' && /^https?:\/\//i.test(value);
                      const renderedValue = isLink ? (
                        <a
                          href={value as string}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:text-blue-700 break-words"
                        >
                          {value as string}
                        </a>
                      ) : typeof value === 'object'
                        ? JSON.stringify(value)
                        : String(value);

                      return (
                        <div key={key} className="contents">
                          <div className="text-slate-500 break-words">{key}</div>
                          <div className="max-h-32 overflow-y-auto border border-slate-200 rounded p-2 text-slate-900 break-words">
                            {renderedValue}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
