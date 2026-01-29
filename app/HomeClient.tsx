"use client";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { enUS } from '@mui/x-date-pickers/locales';
import { Slider } from '@mui/material';
import dayjs from 'dayjs';

import { fetchAds, fetchPageNames, fetchDuplicatesStats } from '@/utils/supabase/db';
import { isUserAdmin } from '@/utils/supabase/admin';
import type { Ad } from '@/lib/types';
import { AdCard } from '@/components/AdCard';
import { ViewToggle } from '@/components/ViewToggle';
import { UserMenu } from '@/components/UserMenu';
import { createClient } from '@/utils/supabase/client';

const PER_PAGE = 24;

export default function HomeClient() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} localeText={enUS.components.MuiLocalizationProvider.defaultProps.localeText}>
      <HomeContent />
    </LocalizationProvider>
  );
}

function HomeContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [displayFormat, setDisplayFormat] = useState<'ALL' | 'IMAGE' | 'VIDEO'>('ALL');
  const [ads, setAds] = useState<Ad[]>([]);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [pageNames, setPageNames] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [authCheckLoading, setAuthCheckLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ownedBusinessIds, setOwnedBusinessIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  // Filters
  const [selectedPage, setSelectedPage] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [aiDescription, setAiDescription] = useState('');
  const [committedAiDescription, setCommittedAiDescription] = useState('');
  type SortByType = 'newest' | 'oldest' | 'start_date_asc' | 'start_date_desc' | undefined;
  const [sortBy, setSortBy] = useState<SortByType>('newest');
  const [duplicatesRange, setDuplicatesRange] = useState<[number, number]>([0, 100]);
  const [duplicatesStats, setDuplicatesStats] = useState<{ min: number; max: number }>({ min: 0, max: 100 });
  const [showDuplicatesSlider, setShowDuplicatesSlider] = useState(false);
  
  // Refs for navigation control
  const duplicatesInitialized = useRef(false);
  const initialized = useRef(false);
  const suppressNextLoad = useRef(false);
  const popHandledAt = useRef<number | null>(null);

  const buildQueryString = useCallback((params: any) => {
    const query = new URLSearchParams();
    if (params.businessId) query.set('businessId', params.businessId);
    if (params.displayFormat && params.displayFormat !== 'ALL') query.set('displayFormat', params.displayFormat);
    if (params.selectedPage) query.set('pageName', params.selectedPage);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.aiDescription) query.set('aiDescription', params.aiDescription);
    if (params.sortBy && params.sortBy !== 'newest') query.set('sortBy', params.sortBy);
    if (params.currentPage && params.currentPage > 1) query.set('page', String(params.currentPage));
    if (params.duplicatesRange) {
      query.set('minDuplicates', String(params.duplicatesRange[0]));
      query.set('maxDuplicates', String(params.duplicatesRange[1]));
    }
    return query.toString();
  }, []);

  // 1. Initial Load & URL Sync
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthCheckLoading(false); return; }

      setUserId(user.id);
      const adminStatus = await isUserAdmin(user.id);
      setIsAdmin(adminStatus);

      const { data: biz } = await supabase.from('businesses').select('*');
      const bData = biz || [];
      setBusinesses(bData);

      const ownedIds = bData.filter(b => b.owner_id === user.id).map(b => b.id);
      setOwnedBusinessIds(ownedIds);
      
      const urlBusinessId = searchParams.get('businessId');
      const initialBusinessId = urlBusinessId || (bData.length > 0 ? bData[0].id : null);
      
      if (!initialBusinessId) {
        router.replace('/choose-business');
        return;
      }
      
      setBusinessId(initialBusinessId);
      
      // Parse other filters from URL
      const displayFormatParam = searchParams.get('displayFormat') as any;
      if (displayFormatParam) setDisplayFormat(displayFormatParam);
      const pageNameParam = searchParams.get('pageName');
      if (pageNameParam) setSelectedPage(pageNameParam);
      const startDateParam = searchParams.get('startDate');
      if (startDateParam) setStartDate(startDateParam);
      const endDateParam = searchParams.get('endDate');
      if (endDateParam) setEndDate(endDateParam);
      const aiDescriptionParam = searchParams.get('aiDescription');
      if (aiDescriptionParam) {
        setAiDescription(aiDescriptionParam);
        setCommittedAiDescription(aiDescriptionParam);
      }
      const sortByParam = searchParams.get('sortBy') as any;
      if (sortByParam) setSortBy(sortByParam);
      const pageParam = searchParams.get('page');
      if (pageParam) setCurrentPage(Number(pageParam));

      const minDupParam = searchParams.get('minDuplicates');
      const maxDupParam = searchParams.get('maxDuplicates');
      if (minDupParam && maxDupParam) {
        setDuplicatesRange([Number(minDupParam), Number(maxDupParam)]);
        duplicatesInitialized.current = true;
      }

      initialized.current = true;
      setAuthCheckLoading(false);
    })();
  }, [router, searchParams]);

  // 2. Browser Back/Forward Handling
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = e.state;
      const my = s?.__myAppState;
      if (my && Array.isArray(my.ads)) {
        // Critical: Set these before state updates trigger effects
        suppressNextLoad.current = true;
        popHandledAt.current = Date.now();
        
        setAds(my.ads);
        setCurrentPage(my.currentPage || 1);
        if (my.duplicatesRange) setDuplicatesRange(my.duplicatesRange);
        setLoading(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 3. Update History State on filter changes
  useEffect(() => {
    if (!initialized.current || !businessId || suppressNextLoad.current) return;

    const queryString = buildQueryString({
      businessId, displayFormat, selectedPage, startDate, endDate,
      aiDescription: committedAiDescription, sortBy, currentPage, duplicatesRange
    });

    const newUrl = queryString ? `/?${queryString}` : '/';
    try {
      const existing = window.history.state || {};
      const newState = { ...existing, __myAppState: { ads, currentPage, duplicatesRange } };
      window.history.replaceState(newState, '', newUrl);
    } catch (err) {
      window.history.replaceState(window.history.state, '', newUrl);
    }
  }, [ads, businessId, displayFormat, selectedPage, startDate, endDate, committedAiDescription, sortBy, currentPage, duplicatesRange, buildQueryString]);

  // 4. Data Loading Logic
  const loadData = useCallback(async () => {
    if (!businessId || !initialized.current) return;

    // Check if we should block this fetch (from popstate)
    if (suppressNextLoad.current || (popHandledAt.current && Date.now() - popHandledAt.current < 1000)) {
      suppressNextLoad.current = false;
      return;
    }

    setLoading(true);
    setRefreshingIds(new Set(ads.map(a => a.ad_archive_id)));

    const params = {
      businessId,
      pageName: selectedPage || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      displayFormat: displayFormat !== 'ALL' ? displayFormat : undefined,
      aiDescription: committedAiDescription || undefined,
      sortBy: sortBy || undefined,
      duplicatesRange: { min: duplicatesRange[0], max: duplicatesRange[1] }
    };

    try {
      const { ads: data, total } = await fetchAds(params, { page: currentPage, perPage: PER_PAGE });
      setAds(data);
      setTotalPages(Math.ceil(total / PER_PAGE));
      setShowDuplicatesSlider(data.length > 0);
    } finally {
      setRefreshingIds(new Set());
      setLoading(false);
    }
  }, [businessId, selectedPage, startDate, endDate, displayFormat, committedAiDescription, currentPage, sortBy, duplicatesRange]);

  // Trigger loadData when filters change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 5. Metadata (Stats/PageNames)
  useEffect(() => {
    if (businessId && initialized.current) {
      (async () => {
        const [pages, stats] = await Promise.all([
          fetchPageNames(businessId),
          fetchDuplicatesStats(businessId)
        ]);
        setPageNames(pages);
        const safeStats = { min: Math.max(1, stats.min), max: Math.max(1, stats.max) };
        setDuplicatesStats(safeStats);
        if (!duplicatesInitialized.current) {
          setDuplicatesRange([safeStats.min, safeStats.max]);
          duplicatesInitialized.current = true;
          setShowDuplicatesSlider(true);
        }
      })();
    }
  }, [businessId]);

  // Debounce AI Search
  useEffect(() => {
    const t = setTimeout(() => setCommittedAiDescription(aiDescription), 1000);
    return () => clearTimeout(t);
  }, [aiDescription]);

  const isOwnedBusiness = (bizId: string) => ownedBusinessIds.includes(bizId);
  const canEditBusiness = (bizId: string) => isAdmin || isOwnedBusiness(bizId);

  if (authCheckLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
    </div>
  );

  // Grouping dates for UI
  const groupedDates = Array.from(new Set(ads.map(a => a.created_at?.split('T')[0]).filter(Boolean)))
    .sort((a, b) => dayjs(b).unix() - dayjs(a).unix());

  return (
    <div className="min-h-screen bg-white text-zinc-900 selection:bg-zinc-100">
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-zinc-100">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-xs font-black tracking-[0.3em] uppercase">Duplicate Tool</span>
          <UserMenu />
        </div>
      </nav>

      <main className="max-w-screen-2xl mx-auto px-6 py-12">
        <header className="mb-16 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <h1 className="text-4xl font-light tracking-tight text-zinc-950 mb-2">Creative Library</h1>
            <p className="text-zinc-400 text-sm font-medium">Monitoring digital visual strategies.</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={businessId || ''} 
              onChange={(e) => {
                const newBizId = e.target.value;
                if (!canEditBusiness(newBizId)) {
                  alert('Access denied.');
                  return;
                }
                if (newBizId !== businessId) {
                  // Reset states for new business
                  setSelectedPage('');
                  setAiDescription('');
                  setCommittedAiDescription('');
                  duplicatesInitialized.current = false;
                  setBusinessId(newBizId);
                }
              }}
              className="h-10 px-4 bg-zinc-50 border border-zinc-100 rounded-lg text-xs font-bold outline-none cursor-pointer"
            >
              {businesses.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name || b.slug} {isOwnedBusiness(b.id) ? '(Owner)' : ''}
                </option>
              ))}
            </select>
            <Link href={`/setup?returnTo=${encodeURIComponent(`/?${buildQueryString({ businessId, displayFormat, selectedPage, startDate, endDate, aiDescription: committedAiDescription, sortBy, currentPage, duplicatesRange })}`)}`} className="h-10 px-5 bg-zinc-950 text-white rounded-lg flex items-center justify-center font-bold text-xs hover:bg-zinc-800 transition-all shadow-sm">
              Import
            </Link>
          </div>
        </header>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Page</label>
            <select 
              value={selectedPage} onChange={e => setSelectedPage(e.target.value)}
              className="h-10 px-3 bg-white border border-zinc-200 rounded-lg text-xs outline-none focus:border-zinc-950"
            >
              <option value="">All Pages</option>
              {pageNames.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">AI Context</label>
            <input 
              type="text" value={aiDescription} onChange={e => setAiDescription(e.target.value)}
              placeholder="Search visual elements..."
              className="h-10 px-4 bg-white border border-zinc-200 rounded-lg text-xs outline-none focus:border-zinc-950"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Start Date</label>
            <DatePicker 
              value={startDate ? dayjs(startDate) : null} 
              onChange={d => setStartDate(d?.format('YYYY-MM-DD') || '')}
              slotProps={{ textField: { size: 'small', fullWidth: true, sx: { '& fieldset': { borderRadius: '8px', border: '1px solid #E4E4E7' }, '& .MuiInputBase-root': { fontSize: '12px' } } } }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">End Date</label>
            <DatePicker 
              value={endDate ? dayjs(endDate) : null} 
              onChange={d => setEndDate(d?.format('YYYY-MM-DD') || '')}
              slotProps={{ textField: { size: 'small', fullWidth: true, sx: { '& fieldset': { borderRadius: '8px', border: '1px solid #E4E4E7' }, '& .MuiInputBase-root': { fontSize: '12px' } } } }}
            />
          </div>
        </div>

        {showDuplicatesSlider && (
          <div className="mb-6 bg-white border border-zinc-200 rounded-lg p-4 max-w-md">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Duplicates</label>
              <span className="text-[10px] font-bold text-zinc-900">{duplicatesRange[0]} - {duplicatesRange[1]}</span>
            </div>
            <Slider
              value={duplicatesRange}
              onChange={(_, newValue) => setDuplicatesRange(newValue as [number, number])}
              min={Math.max(1, duplicatesStats.min)}
              max={Math.max(1, duplicatesStats.max)}
              sx={{ color: '#18181b' }}
            />
          </div>
        )}

        <div className="flex items-center justify-between py-6 mb-8 border-y border-zinc-50">
          <div className="bg-zinc-50 p-1 rounded-lg border border-zinc-100">
            <ViewToggle value={displayFormat} onChange={setDisplayFormat} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">Results</span>
            <span className="text-xs font-bold tabular-nums">{ads.length}</span>
          </div>
        </div>

        {loading && ads.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {[...Array(12)].map((_, i) => <div key={i} className="aspect-[3/4] bg-zinc-50 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-24">
            {groupedDates.map(date => (
              <section key={date}>
                <div className="flex items-center gap-4 mb-10">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-900">{dayjs(date).format('MMM D, YYYY')}</h2>
                  <div className="h-[1px] flex-1 bg-zinc-100" />
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-12">
                  {ads.filter(a => a.created_at?.startsWith(date)).map((ad, idx) => {
                    const currentQs = buildQueryString({
                      businessId, displayFormat, selectedPage, startDate, endDate,
                      aiDescription: committedAiDescription, sortBy, currentPage, duplicatesRange
                    });
                    const viewParams = new URLSearchParams(currentQs);
                    viewParams.set('returnTo', `/?${currentQs}`);

                    return (
                      <Link key={ad.ad_archive_id + idx} href={`/view/${ad.ad_archive_id}?${viewParams.toString()}`} className="group block p-3 rounded-xl transition-all duration-500 hover:bg-zinc-50 hover:shadow-2xl border border-transparent hover:border-zinc-200">
                        <div className="aspect-[3/4] mb-4 overflow-hidden rounded-lg bg-zinc-50">
                          <AdCard ad={ad} isRefreshing={refreshingIds.has(ad.ad_archive_id)} />
                        </div>
                        <div className="space-y-2 px-1">
                          <p className="text-[10px] font-black text-zinc-950 truncate uppercase">{ad.page_name}</p>
                          <p className="text-[9px] font-bold text-zinc-400">ID: {ad.ad_archive_id}</p>
                          <div className="mt-2 text-[9px] text-zinc-500 flex items-center justify-between">
                            <span className="font-bold">Total Items:</span>
                            <span className="tabular-nums">{ad.items ?? ad.duplicates_count ?? '—'}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-32 py-12 border-t border-zinc-100 flex flex-col items-center">
          <div className="flex items-center gap-6">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="text-[10px] font-black uppercase tracking-widest disabled:opacity-10">Prev</button>
            <div className="flex items-center gap-4">
              <span className="text-xs font-bold">{currentPage} / {totalPages}</span>
            </div>
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="text-[10px] font-black uppercase tracking-widest disabled:opacity-10">Next</button>
          </div>
        </footer>
      </main>

      <style jsx global>{`
        body { background-color: #ffffff; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #E4E4E7; border-radius: 10px; }
      `}</style>
    </div>
  );
}