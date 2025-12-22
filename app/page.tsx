'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { fetchAds, fetchPageNames } from '@/lib/db';
import type { Ad } from '@/lib/types';
import { AdCard } from '@/components/AdCard';
import { ViewToggle } from '@/components/ViewToggle';
import { DUPLICATES_RANGES } from '@/lib/types';

const PER_PAGE = 18;

export default function Home() {
  const [displayFormat, setDisplayFormat] = useState<'ALL' | 'IMAGE' | 'VIDEO'>('ALL');
  const [ads, setAds] = useState<Ad[]>([]);
  const [pageNames, setPageNames] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Filters
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [selectedDuplicates, setSelectedDuplicates] = useState<string>('');

  async function loadPageNames() {
    const pages = await fetchPageNames();
    setPageNames(pages);
  }

  const loadAds = useCallback(async () => {
    setLoading(true);
    
    const duplicatesRange = DUPLICATES_RANGES.find(r => r.label === selectedDuplicates);
    
    const { ads: data, total } = await fetchAds(
      {
        pageName: selectedPage || undefined,
        duplicatesRange: duplicatesRange ? { min: duplicatesRange.min, max: duplicatesRange.max } : undefined,
      },
      {
        page: currentPage,
        perPage: PER_PAGE,
      }
    );
    
    console.log('Received ads:', data.length, 'Total:', total);
    setAds(data);
    setTotalPages(Math.ceil(total / PER_PAGE));
    setLoading(false);
  }, [selectedPage, selectedDuplicates, currentPage]);

  useEffect(() => {
    loadPageNames();
  }, []);

  useEffect(() => {
    setCurrentPage(1); // Reset to page 1 when filters change
    loadAds();
  }, [selectedPage, selectedDuplicates, loadAds]);

  useEffect(() => {
    loadAds();
  }, [currentPage, loadAds]);

  // Load data on initial mount
  useEffect(() => {
    loadAds();
  }, [loadAds]);

  const filteredAds = displayFormat === 'ALL' 
    ? ads 
    : ads.filter(ad => ad.display_format === displayFormat);

  console.log('Filtered ads:', filteredAds.length, 'Display format:', displayFormat);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Ad Gallery</h1>
          <p className="text-slate-600">Browse creative advertisements</p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Page Name</label>
            <select
              value={selectedPage}
              onChange={(e) => setSelectedPage(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
            >
              <option value="">All Pages</option>
              {pageNames.map((page) => (
                <option key={page.name} value={page.name}>
                  {page.name} ({page.count})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Duplicates</label>
            <select
              value={selectedDuplicates}
              onChange={(e) => setSelectedDuplicates(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
            >
              <option value="">All</option>
              {DUPLICATES_RANGES.map((range) => (
                <option key={range.label} value={range.label}>
                  {range.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ViewToggle 
          value={displayFormat} 
          onChange={setDisplayFormat}
        />

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-500">Loading...</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {filteredAds.map((ad) => (
                <Link key={ad.id} href={`/view/${ad.ad_archive_id}`}>
                  <AdCard ad={ad} />
                </Link>
              ))}
            </div>

            {filteredAds.length === 0 && (
              <div className="text-center py-12">
                <p className="text-slate-500">No ads found</p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                >
                  Previous
                </button>
                
                <div className="flex gap-2">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-4 py-2 border rounded-lg ${
                          currentPage === pageNum
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
