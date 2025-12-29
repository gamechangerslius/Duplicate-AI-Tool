"use client";

import { useState } from 'react';
import Image from 'next/image';
import type { Ad } from '@/lib/types';
import { getImageUrl } from '@/lib/db';

interface Props {
  ads: Ad[];
  groupSize: number;
  vectorGroup: number;
  currentAdArchiveId: string;
  sourceTable?: string;
  bucket?: string;
}

export function RelatedAdsGrid({ ads, groupSize, vectorGroup, currentAdArchiveId, sourceTable, bucket }: Props) {
  const [selected, setSelected] = useState<Ad | null>(null);
  const [items, setItems] = useState<Ad[]>(ads);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(ads.length ? ads[ads.length - 1].ad_archive_id : null);
  const [hasMore, setHasMore] = useState(true);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ vector_group: String(vectorGroup), current_id: currentAdArchiveId, limit: '60' });
      if (sourceTable) params.set('table', sourceTable);
      if (cursor) params.set('last_id', cursor);
      const res = await fetch(`/api/related-ads?${params.toString()}`);
      const json = await res.json();
      const newItems: Ad[] = json.items || [];
      if (newItems.length > 0) {
        setItems(prev => [...prev, ...newItems]);
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
            key={ad.id}
            type="button"
            onClick={() => setSelected(ad)}
            className="group text-left"
            aria-label={`Open details for ${ad.ad_archive_id}`}
          >
            <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden">
              <div className="relative aspect-square bg-slate-100">
                <Image
                  src={ad.image_url || getImageUrl(ad.ad_archive_id, bucket)}
                  alt={ad.title || ad.page_name}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  unoptimized
                />
              </div>
              <div className="px-3 py-2 border-t border-slate-200 space-y-1">
                <div className="text-xs text-slate-900 font-medium truncate" title={ad.title || 'Untitled'}>
                  {ad.title || 'Untitled'}
                </div>
                <div className="text-[11px] text-slate-600 truncate" title={ad.ad_archive_id}>
                  {ad.ad_archive_id}
                </div>
                <div className="text-[11px] text-slate-500 truncate" title={ad.start_date_formatted}> </div>
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
                  src={selected.image_url || getImageUrl(selected.ad_archive_id, bucket)}
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
