'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Slider from '@mui/material/Slider';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { enUS } from '@mui/x-date-pickers/locales';
import dayjs from 'dayjs';

import { fetchAds, fetchPageNames, fetchDuplicatesStats } from '@/utils/supabase/db';
import type { Ad } from '@/lib/types';
import { AdCard } from '@/components/AdCard';
import { ViewToggle } from '@/components/ViewToggle';
import { UserMenu } from '@/components/UserMenu';
import { createClient } from '@/utils/supabase/client';

const PER_PAGE = 24;

type DisplayFormat = 'ALL' | 'IMAGE' | 'VIDEO';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeNicheForDb(nicheUi: string): string {
  const s = (nicheUi || '').trim().toLowerCase();
  if (!s) return '';
  // if you ever stored "romantic novels" in UI, map it to db value.
  if (s === 'romantic novels') return 'passion';
  return s;
}

export default function HomeClient() {
  const searchParams = useSearchParams();

  return (
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      localeText={enUS.components.MuiLocalizationProvider.defaultProps.localeText}
    >
      <HomeClientContent searchParams={searchParams} />
    </LocalizationProvider>
  );
}

function HomeClientContent({
  searchParams,
}: {
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('ALL');

  // ===== Data =====
  const [ads, setAds] = useState<Ad[]>([]);
  const [pageNames, setPageNames] = useState<{ name: string; count: number }[]>([]);

  // ===== Loading flags =====
  const [loading, setLoading] = useState(true);
  
  // ===== Auth state =====
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authCheckLoading, setAuthCheckLoading] = useState(true);

  // ===== Pagination =====
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // ===== Init guard =====
  const [isInitialized, setIsInitialized] = useState(false);
  const initRef = useRef(false);
  const prevFiltersKeyRef = useRef<string | null>(null);

  // ===== Debounce refs =====
  const filterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const duplicatesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ===== Business ID and list =====
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<{ id: string; slug: string; name?: string; accessStatus?: 'owner' | 'access' | 'view' }[]>([]);

  // ===== Filters =====
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [selectedNiche, setSelectedNiche] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // ===== Duplicates slider model =====
  const [duplicatesStats, setDuplicatesStats] = useState<{ min: number; max: number }>({
    min: 0,
    max: 0,
  });

  // draft = while dragging, applied = used in DB query
  const [duplicatesRangeDraft, setDuplicatesRangeDraft] = useState<[number, number]>([0, 0]);
  const [duplicatesRangeApplied, setDuplicatesRangeApplied] = useState<[number, number]>([0, 0]);

  // dirty = user changed slider but not yet applied (debounced)
  const [dupsDirty, setDupsDirty] = useState(false);

  // IMPORTANT:
  // We only add `duplicates=` to URL once user actually applied it.
  const [dupsEverApplied, setDupsEverApplied] = useState(false);

  /**
   * Update URL params (without pushing history).
   * We intentionally only include duplicates when user has applied them.
   */
  const updateUrlParams = useCallback(
    (next: {
      businessId?: string | null;
      page: string;
      niche: string;
      format?: DisplayFormat;
      startDate?: string;
      endDate?: string;
      duplicatesApplied?: [number, number] | null;
      pageNumber?: number;
    }) => {
      const params = new URLSearchParams();

      if (next.businessId) params.set('businessId', next.businessId);
      if (next.page) params.set('page', next.page);
      if (next.niche && next.niche.trim()) params.set('niche', next.niche);
      if (next.format && next.format !== 'ALL') params.set('format', next.format);
      if (next.startDate) params.set('startDate', next.startDate);
      if (next.endDate) params.set('endDate', next.endDate);

      if (next.duplicatesApplied) {
        params.set('duplicates', `${next.duplicatesApplied[0]}-${next.duplicatesApplied[1]}`);
      }

      if (typeof next.pageNumber === 'number' && next.pageNumber > 1) {
        params.set('p', String(next.pageNumber));
      }

      const newUrl = params.toString() ? `?${params.toString()}` : '/';
      window.history.replaceState({}, '', newUrl);
    },
    []
  );

  /**
   * Build duplicates filter for DB query.
   * If user never applied duplicates filter, we query "all" duplicates.
   */
  const buildDuplicatesFilter = useCallback(() => {
    if (!dupsEverApplied) return { min: 0, max: 999999 };
    return { min: duplicatesRangeApplied[0], max: duplicatesRangeApplied[1] };
  }, [dupsEverApplied, duplicatesRangeApplied]);

  /**
   * Load duplicates stats from the database for the selected business and filters.
   */
  const loadDuplicatesStats = useCallback(async () => {
    if (!businessId) return;

    const nicheForDb = selectedNiche ? normalizeNicheForDb(selectedNiche) : undefined;

    try {
      const stats = await fetchDuplicatesStats(
        businessId,
        selectedPage || undefined,
        nicheForDb,
        {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          displayFormat: displayFormat === 'ALL' ? undefined : displayFormat,
        }
      );

      console.log('📊 Loaded duplicates stats:', stats);

      setDuplicatesStats(stats);

      // If user never applied duplicates filter, set to full range
      if (!dupsEverApplied) {
        setDuplicatesRangeDraft([stats.min, stats.max]);
        setDuplicatesRangeApplied([stats.min, stats.max]);
        setDupsDirty(false);
      } else {
        // Clamp existing ranges to new bounds
        setDuplicatesRangeApplied(([a, b]) => {
          const next: [number, number] = [clamp(a, stats.min, stats.max), clamp(b, stats.min, stats.max)];
          return next[0] === a && next[1] === b ? [a, b] : next;
        });
        setDuplicatesRangeDraft(([a, b]) => {
          const next: [number, number] = [clamp(a, stats.min, stats.max), clamp(b, stats.min, stats.max)];
          return next[0] === a && next[1] === b ? [a, b] : next;
        });
      }
    } catch (err) {
      console.error('loadDuplicatesStats error:', err);
    }
  }, [businessId, selectedPage, selectedNiche, startDate, endDate, displayFormat, dupsEverApplied]);

  /**
   * Load page names for selected business.
   */
  const loadPageNames = useCallback(async () => {
    if (!businessId) return;
    const pages = await fetchPageNames(businessId);
    setPageNames(pages);
  }, [businessId]);

  /**
   * Load ads for a specific page (replaces the list).
   */
  const loadAds = useCallback(
    async (pageToLoad: number) => {
      if (!businessId) return;

      setLoading(true);

      const nicheForDb = selectedNiche ? normalizeNicheForDb(selectedNiche) : undefined;

      try {
        const { ads: data, total } = await fetchAds(
          {
            businessId,
            pageName: selectedPage || undefined,
            duplicatesRange: buildDuplicatesFilter(),
            competitorNiche: nicheForDb,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            displayFormat: displayFormat === 'ALL' ? undefined : displayFormat,
          },
          { page: pageToLoad, perPage: PER_PAGE }
        );

        setAds(data);
        setTotalPages(Math.max(1, Math.ceil(total / PER_PAGE)));
        setCurrentPage(pageToLoad);
      } catch (err) {
        console.error('loadAds error:', err);
      } finally {
        setLoading(false);
      }
    },
    [businessId, selectedPage, selectedNiche, startDate, endDate, displayFormat, buildDuplicatesFilter]
  );

  // ===== 1) Init business + filters from URL (run once) =====
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initBusinessAndFilters = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Check authentication status
      if (!user) {
        console.log('User not authenticated');
        setIsAuthenticated(false);
        setAuthCheckLoading(false);
        return;
      }

      setIsAuthenticated(true);
      setAuthCheckLoading(false);

      // businessId from URL (optional)
      const rawBusinessParam = searchParams.get('businessId');
      const currentBusinessId = rawBusinessParam ? rawBusinessParam.split(',')[0] : null;

      // load ALL businesses
      const allBusinessesResult = await supabase
        .from('businesses')
        .select('id, slug, name, owner_id')
        .limit(1000);

      if (allBusinessesResult.error) {
        console.error('Error fetching all businesses:', allBusinessesResult.error);
        return;
      }

      const allBusinessesData = allBusinessesResult.data || [];
      console.log('All available businesses:', allBusinessesData);
      
      if (allBusinessesData.length === 0) {
        console.warn('No businesses available');
        return;
      }

      // Get user's access info
      const userOwnedBusinessIds = new Set<string>();
      const userAccessBusinessIds = new Set<string>();

      // Check owned businesses
      for (const biz of allBusinessesData) {
        if (biz.owner_id === user.id) {
          userOwnedBusinessIds.add(biz.id);
        }
      }

      // Check access via business_access table
      const { data: accessData, error: accessError } = await supabase
        .from('business_access')
        .select('business_id')
        .eq('user_id', user.id);

      if (!accessError && accessData) {
        for (const row of accessData) {
          userAccessBusinessIds.add(row.business_id);
        }
      }

      // Add access status to each business
      const allBusinessesWithStatus = allBusinessesData.map((biz: any) => ({
        ...biz,
        accessStatus: userOwnedBusinessIds.has(biz.id) 
          ? 'owner' 
          : userAccessBusinessIds.has(biz.id) 
          ? 'access' 
          : 'view',
      }));

      setBusinesses(allBusinessesWithStatus);

      // default business
      const defaultBusiness = currentBusinessId || allBusinessesWithStatus[0].id;
      setBusinessId(defaultBusiness);

      // init filters from URL
      const pageName = searchParams.get('page') || '';
      const niche = searchParams.get('niche') || '';
      const fmt = (searchParams.get('format') as DisplayFormat) || 'ALL';
      const start = searchParams.get('startDate') || '';
      const end = searchParams.get('endDate') || '';
      const pageFromUrl = Number(searchParams.get('p') || '1');

      setSelectedPage(pageName);
      setSelectedNiche(niche);
      setDisplayFormat(fmt === 'IMAGE' || fmt === 'VIDEO' ? fmt : 'ALL');
      setStartDate(start);
      setEndDate(end);

      if (Number.isFinite(pageFromUrl) && pageFromUrl > 1) {
        setCurrentPage(Math.floor(pageFromUrl));
      }

      // duplicates param (optional)
      // We can't apply it immediately because we need stats bounds first.
      // So we store it in state once stats are computed (see effect below).
      const dupRaw = searchParams.get('duplicates');
      if (dupRaw) {
        const m = dupRaw.match(/^(\d+)-(\d+)$/);
        if (m) {
          const a = Number(m[1]);
          const b = Number(m[2]);
          if (Number.isFinite(a) && Number.isFinite(b)) {
            // set as "ever applied" early; actual clamping happens later
            setDupsEverApplied(true);
            setDuplicatesRangeApplied(a <= b ? [a, b] : [b, a]);
            setDuplicatesRangeDraft(a <= b ? [a, b] : [b, a]);
          }
        }
      }

      setIsInitialized(true);
    };

    initBusinessAndFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 2) Load page names when businessId changes =====
  useEffect(() => {
    if (!businessId) return;
    loadPageNames();
  }, [businessId, loadPageNames]);

  // ===== 3) Reset to page 1 when filters change =====
  useEffect(() => {
    if (!isInitialized) return;

    const key = [
      businessId || '',
      selectedPage,
      selectedNiche,
      startDate,
      endDate,
      dupsEverApplied ? `${duplicatesRangeApplied[0]}-${duplicatesRangeApplied[1]}` : '',
    ].join('|');

    if (prevFiltersKeyRef.current && prevFiltersKeyRef.current !== key) {
      setCurrentPage(1);
    }

    prevFiltersKeyRef.current = key;
  }, [
    isInitialized,
    businessId,
    selectedPage,
    selectedNiche,
    startDate,
    endDate,
    dupsEverApplied,
    duplicatesRangeApplied,
  ]);

  // ===== 4) MAIN effect: load data when filters or page change =====
  useEffect(() => {
    if (!isInitialized) return;
    if (!businessId) return;

    if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current);

    filterTimeoutRef.current = setTimeout(() => {
      loadAds(currentPage);

      updateUrlParams({
        businessId,
        page: selectedPage,
        niche: selectedNiche,
        format: displayFormat,
        startDate,
        endDate,
        duplicatesApplied: dupsEverApplied ? duplicatesRangeApplied : null,
        pageNumber: currentPage,
      });
    }, 300);

    return () => {
      if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current);
    };
  }, [
    isInitialized,
    businessId,
    currentPage,
    selectedPage,
    selectedNiche,
    startDate,
    endDate,
    displayFormat,
    dupsEverApplied,
    duplicatesRangeApplied,
    loadAds,
    updateUrlParams,
  ]);

  // ===== 5) Load duplicates stats when filters change (but not page number) =====
  useEffect(() => {
    if (!isInitialized) return;
    if (!businessId) return;

    loadDuplicatesStats();
  }, [isInitialized, businessId, selectedPage, selectedNiche, startDate, endDate, displayFormat, loadDuplicatesStats]);

  // ===== 6) Debounced auto-apply duplicates draft -> applied =====
  useEffect(() => {
    if (!isInitialized) return;
    if (!dupsDirty) return;

    if (duplicatesTimeoutRef.current) clearTimeout(duplicatesTimeoutRef.current);

    duplicatesTimeoutRef.current = setTimeout(() => {
      setDuplicatesRangeApplied(duplicatesRangeDraft);
      setDupsDirty(false);
      setDupsEverApplied(true);
      // URL will be updated by main effect (because applied range changed)
    }, 400);

    return () => {
      if (duplicatesTimeoutRef.current) clearTimeout(duplicatesTimeoutRef.current);
    };
  }, [duplicatesRangeDraft, dupsDirty, isInitialized]);

  // ===== Business selector handler =====
  const handleBusinessChange = useCallback(
    (newBusinessId: string) => {
      setBusinessId(newBusinessId);
      setAds([]);
      setCurrentPage(1);

      // Update URL immediately (keep other params)
      updateUrlParams({
        businessId: newBusinessId,
        page: selectedPage,
        niche: selectedNiche,
        format: displayFormat,
        startDate,
        endDate,
        duplicatesApplied: dupsEverApplied ? duplicatesRangeApplied : null,
        pageNumber: 1,
      });
    },
    [
      updateUrlParams,
      selectedPage,
      selectedNiche,
      displayFormat,
      startDate,
      endDate,
      dupsEverApplied,
      duplicatesRangeApplied,
    ]
  );

  // ===== Client-side format filter =====
  const filteredAds = useMemo(() => {
    if (displayFormat === 'ALL') return ads;
    return ads.filter((ad) => (ad as any).display_format === displayFormat);
  }, [ads, displayFormat]);

  // ===== Pagination helpers =====
  const paginationRange = useMemo(() => {
    const maxButtons = 7;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_v, idx) => idx + 1);
    }

    const start = Math.max(1, currentPage - 3);
    const end = Math.min(totalPages, start + maxButtons - 1);
    const adjustedStart = Math.max(1, end - maxButtons + 1);

    return Array.from({ length: end - adjustedStart + 1 }, (_v, idx) => adjustedStart + idx);
  }, [currentPage, totalPages]);

  // ===== Group ads by processed date ===== 
  const adsByProcessedDate = useMemo(() => {
    const groups = new Map<string, typeof filteredAds>();
    
    for (const ad of filteredAds) {
      // Extract date from created_at or use current date
      const dateStr = ad.created_at ? ad.created_at.split('T')[0] : new Date().toISOString().split('T')[0];
      
      if (!groups.has(dateStr)) {
        groups.set(dateStr, []);
      }
      groups.get(dateStr)!.push(ad);
    }

    // Sort dates in descending order (newest first)
    return Array.from(groups.entries()).sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  }, [filteredAds]);

  const handlePageChange = useCallback(
    (pageNum: number) => {
      const nextPage = clamp(pageNum, 1, totalPages || 1);
      if (nextPage === currentPage) return;
      setCurrentPage(nextPage);
    },
    [currentPage, totalPages]
  );

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage === 1 || loading}
          className="group px-4 py-2 rounded-lg bg-white border-2 border-slate-200 text-slate-700 font-medium shadow-sm hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-white transition-all duration-200"
        >
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Previous</span>
          </span>
        </button>

        <div className="flex items-center gap-1.5">
          {paginationRange.map((pageNum) => (
            <button
              key={pageNum}
              type="button"
              onClick={() => handlePageChange(pageNum)}
              disabled={loading && pageNum === currentPage}
              className={`min-w-[2.5rem] h-10 px-2.5 rounded-lg font-semibold text-sm transition-all duration-200 shadow-sm ${
                pageNum === currentPage
                  ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white border-2 border-blue-600 shadow-blue-200 scale-105'
                  : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              aria-current={pageNum === currentPage ? 'page' : undefined}
            >
              {pageNum}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= totalPages || loading}
          className="group px-4 py-2 rounded-lg bg-white border-2 border-slate-200 text-slate-700 font-medium shadow-sm hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-white transition-all duration-200"
        >
          <span className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Next</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </button>

        <div className="sm:hidden text-xs text-slate-600 font-medium">
          Page {currentPage} of {totalPages}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Check if authentication is loading */}
      {authCheckLoading && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <p className="text-slate-600">Loading...</p>
          </div>
        </div>
      )}

      {/* Show login message if not authenticated */}
      {!authCheckLoading && !isAuthenticated && (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
          <div className="bg-white rounded-xl shadow-lg p-12 text-center max-w-md w-full mx-4">
            <div className="mb-6">
              <svg className="w-16 h-16 mx-auto text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Login Required</h2>
            <p className="text-slate-600 mb-8">You need to log in to view advertisements. Please sign in with your account to continue.</p>
            <Link href="/auth" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg">
              Sign In
            </Link>
          </div>
        </div>
      )}

      {/* Show ads content if authenticated */}
      {!authCheckLoading && isAuthenticated && (
        <div className="container mx-auto px-6 py-12">
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-4xl font-bold text-slate-900">Ad Gallery</h1>
              <UserMenu />
            </div>
            <p className="text-slate-600">Browse creative advertisements</p>

            {/* Business selector */}
          {businesses.length > 0 && (
            <div className="mt-4 mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Select Business:</label>
              <select
                value={businessId || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'CREATE_NEW') {
                    // Redirect to auth page where user can create new business
                    window.location.href = '/auth?action=create-business';
                  } else {
                    handleBusinessChange(value);
                  }
                }}
                className="block w-full px-4 py-2 border border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 bg-white"
              >
                {businesses.map((biz) => {
                  const statusLabel = 
                    biz.accessStatus === 'owner' ? 'owner' :
                    biz.accessStatus === 'access' ? 'access' :
                    'view only';
                  const mainText = biz.name || biz.slug;
                  return (
                    <option key={biz.id} value={biz.id}>
                      {mainText}  ·  {statusLabel}
                    </option>
                  );
                })}
                <option value="CREATE_NEW" style={{ fontWeight: 'bold', color: '#2563eb' }}>
                  + Create New Business
                </option>
              </select>
              <style jsx>{`
                select option {
                  font-size: 14px;
                  color: #1e293b;
                }
              `}</style>
            </div>
          )}

          {/* Active filters summary */}
          <div className="mt-4 flex flex-wrap gap-2 items-center">
            {(selectedPage ||
              selectedNiche ||
              startDate ||
              endDate ||
              (duplicatesStats.max > duplicatesStats.min && dupsEverApplied) ||
              displayFormat !== 'ALL') && (
              <>
                <span className="text-sm text-slate-600">Active filters:</span>

                {selectedPage && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs">
                    📄 {selectedPage}
                  </span>
                )}

                {selectedNiche && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 text-purple-700 text-xs">
                    🎯 {selectedNiche === 'passion' ? 'Romantic novels' : selectedNiche}
                  </span>
                )}

                {startDate && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs">
                    📅 from {startDate}
                  </span>
                )}

                {endDate && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs">
                    📅 to {endDate}
                  </span>
                )}

                {dupsEverApplied && duplicatesStats.max > duplicatesStats.min && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-orange-100 text-orange-700 text-xs">
                    📊 {duplicatesRangeApplied[0]}-{duplicatesRangeApplied[1]} duplicates
                  </span>
                )}

                {displayFormat !== 'ALL' && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs">
                    {displayFormat === 'IMAGE' ? '🖼️ Images' : '🎬 Videos'}
                  </span>
                )}
              </>
            )}

            {loading && <span className="text-sm text-blue-600 animate-pulse">⏳ Loading...</span>}
            {!loading && ads.length > 0 && <span className="text-sm text-slate-600">✓ {ads.length} ads</span>}
          </div>
        </div>

        {/* ===== Filters ===== */}
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
            <label className="block text-sm font-medium text-slate-700 mb-2">Competitor Niche</label>
            <select
              value={selectedNiche}
              onChange={(e) => setSelectedNiche(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
            >
              <option value="">All</option>
              <option value="drama">Drama</option>
              <option value="passion">Romantic novels</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Start Date</label>
            <DatePicker
              label=""
              value={startDate ? dayjs(startDate) : null}
              onChange={(date) => setStartDate(date ? date.format('YYYY-MM-DD') : '')}
              slotProps={{
                textField: {
                  size: 'small',
                  placeholder: 'YYYY-MM-DD',
                  sx: {
                    '& .MuiOutlinedInput-root': {
                      borderColor: '#cbd5e1',
                      backgroundColor: '#ffffff',
                      '&:hover': { borderColor: '#94a3b8' },
                      '&.Mui-focused': { backgroundColor: '#f8fafc' },
                    },
                    '& .MuiInputBase-input': { color: '#0f172a', fontSize: '0.875rem' },
                    '& .MuiInputLabel-root': { color: '#475569', fontSize: '0.875rem' },
                  },
                },
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">End Date</label>
            <DatePicker
              label=""
              value={endDate ? dayjs(endDate) : null}
              onChange={(date) => setEndDate(date ? date.format('YYYY-MM-DD') : '')}
              slotProps={{
                textField: {
                  size: 'small',
                  placeholder: 'YYYY-MM-DD',
                  sx: {
                    '& .MuiOutlinedInput-root': {
                      borderColor: '#cbd5e1',
                      backgroundColor: '#ffffff',
                      '&:hover': { borderColor: '#94a3b8' },
                      '&.Mui-focused': { backgroundColor: '#f8fafc' },
                    },
                    '& .MuiInputBase-input': { color: '#0f172a', fontSize: '0.875rem' },
                    '& .MuiInputLabel-root': { color: '#475569', fontSize: '0.875rem' },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* ===== Duplicates slider and Pagination ===== */}
        <div className="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* Duplicates slider */}
          {duplicatesStats.max > 0 && (
            <div className="flex-1 max-w-md">
              {duplicatesStats.max === duplicatesStats.min ? (
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-700">
                  <div className="font-medium mb-1">Duplicates Range</div>
                  <div>
                    All ads have the same number of duplicates: <strong>{duplicatesStats.min}</strong>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Duplicates</label>
                    <div className="text-sm text-slate-600">
                      {duplicatesRangeDraft[0]} – {duplicatesRangeDraft[1]}
                      {dupsDirty && <span className="ml-2 text-blue-600">(applying...)</span>}
                    </div>
                  </div>

                  <Box
                    sx={{
                      px: 2,
                      py: 2,
                      bgcolor: 'white',
                      borderRadius: '0.5rem',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                      <Typography variant="caption" sx={{ color: '#64748b', minWidth: '24px' }}>
                        {duplicatesStats.min}
                      </Typography>

                      <Slider
                        value={duplicatesRangeDraft}
                        onChange={(_e, newValue) => {
                          const v = newValue as [number, number];
                          setDuplicatesRangeDraft(v);
                          setDupsDirty(true);
                        }}
                        onChangeCommitted={(_e, newValue) => {
                          const v = newValue as [number, number];
                          setDuplicatesRangeDraft(v);
                          setDuplicatesRangeApplied(v);
                          setDupsDirty(false);
                          setDupsEverApplied(true);

                          // Persist immediately (so back navigation keeps the range)
                          updateUrlParams({
                            businessId,
                            page: selectedPage,
                            niche: selectedNiche,
                            format: displayFormat,
                            startDate,
                            endDate,
                            duplicatesApplied: v,
                          });
                        }}
                        min={duplicatesStats.min}
                        max={duplicatesStats.max}
                        step={1}
                        disableSwap
                        valueLabelDisplay="auto"
                        sx={{
                          flex: 1,
                          '& .MuiSlider-thumb': { height: 16, width: 16 },
                          '& .MuiSlider-track': { height: 5 },
                          '& .MuiSlider-rail': { height: 5 },
                        }}
                      />

                      <Typography variant="caption" sx={{ color: '#64748b', minWidth: '24px', textAlign: 'right' }}>
                        {duplicatesStats.max}
                      </Typography>
                    </Box>
                  </Box>
                </>
              )}
            </div>
          )}
        </div>

        {/* ===== View toggle (ALL/IMAGE/VIDEO) ===== */}
        <ViewToggle value={displayFormat} onChange={setDisplayFormat} />

        {/* ===== Pagination top ===== */}
        <div className="my-6">
          {renderPagination()}
        </div>

        {/* ===== Ads Grid with date grouping ===== */}
        {adsByProcessedDate.map(([processedDate, adsForDate]) => (
          <div key={processedDate} className="mb-8">
            {/* Date Header */}
            <div className="mb-4 flex items-center gap-3 px-2">
              <div className="text-sm font-semibold text-slate-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                📅 Processed on {new Date(processedDate).toLocaleDateString('uk-UA', { 
                  weekday: 'short', 
                  year: 'numeric', 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </div>
              <div className="text-xs text-slate-500">{adsForDate.length} creatives</div>
            </div>

            {/* Ads Grid for this date */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {adsForDate.map((ad, idx) => (
                <Link
                  key={`${(ad as any).id}-${(ad as any).ad_archive_id}-${idx}`}
                  href={`/view/${(ad as any).ad_archive_id}?businessId=${businessId}&page=${selectedPage}${
                    dupsEverApplied ? `&duplicates=${duplicatesRangeApplied[0]}-${duplicatesRangeApplied[1]}` : ''
                  }${selectedNiche ? `&niche=${selectedNiche}` : ''}${
                    displayFormat !== 'ALL' ? `&format=${displayFormat}` : ''
                  }${startDate ? `&startDate=${startDate}` : ''}${endDate ? `&endDate=${endDate}` : ''}`}
                >
                  <AdCard ad={ad} />
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* ===== Empty / Loading states ===== */}
        {!loading && filteredAds.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500">No ads found</p>
          </div>
        )}

        {loading && ads.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500">Loading...</p>
          </div>
        )}

        {/* ===== Pagination bottom ===== */}
        <div className="mt-8">
          {renderPagination()}
        </div>
        </div>
      )}
    </div>
  );
}
