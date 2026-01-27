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
  type SortByType = 'newest' | 'oldest' | 'start_date_asc' | 'start_date_desc' | undefined;
  const [sortBy, setSortBy] = useState<SortByType>('newest');
  const [duplicatesRange, setDuplicatesRange] = useState<[number, number]>([0, 100]);
  const [duplicatesStats, setDuplicatesStats] = useState<{ min: number; max: number }>({ min: 0, max: 100 });
  
  // Track if we've initialized from URL
  const initialized = useRef(false);

  // Function to build query string from current filters
  const buildQueryString = useCallback((params: {
    displayFormat?: string;
    selectedPage?: string;
    startDate?: string;
    endDate?: string;
    aiDescription?: string;
    sortBy?: SortByType;
    currentPage?: number;
    businessId?: string;
    duplicatesRange?: [number, number];
  }) => {
    const query = new URLSearchParams();
    if (params.businessId) query.set('businessId', params.businessId);
    if (params.displayFormat && params.displayFormat !== 'ALL') query.set('displayFormat', params.displayFormat);
    if (params.selectedPage) query.set('pageName', params.selectedPage);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.aiDescription) query.set('aiDescription', params.aiDescription);
    if (params.sortBy && params.sortBy !== 'newest') query.set('sortBy', params.sortBy);
    if (params.currentPage && params.currentPage > 1) query.set('page', String(params.currentPage));
    if (params.duplicatesRange && (params.duplicatesRange[0] > 0 || params.duplicatesRange[1] < 100)) {
      query.set('minDuplicates', String(params.duplicatesRange[0]));
      query.set('maxDuplicates', String(params.duplicatesRange[1]));
    }
    return query.toString();
  }, []);

  // Initialize businesses and filters from URL on mount
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthCheckLoading(false); return; }

      setUserId(user.id);
      const adminStatus = await isUserAdmin(user.id);
      setIsAdmin(adminStatus);

      // Load all businesses
      const { data: biz } = await supabase.from('businesses').select('*');
      const bData = biz || [];
      setBusinesses(bData);

      // Track which businesses user owns
      const ownedIds = bData
        .filter(b => b.owner_id === user.id)
        .map(b => b.id);
      setOwnedBusinessIds(ownedIds);
      
      // Initialize all filters from URL
      const urlBusinessId = searchParams.get('businessId');
      const initialBusinessId = urlBusinessId || (bData.length > 0 ? bData[0].id : null);
      
      // If no business selected, redirect to choose-business page
      if (!initialBusinessId) {
        router.replace('/choose-business');
        return;
      }
      
      if (initialBusinessId) {
        setBusinessId(initialBusinessId);
        const pages = await fetchPageNames(initialBusinessId);
        
        // Fetch duplicates stats for slider range
        const stats = await fetchDuplicatesStats(initialBusinessId);
        setDuplicatesStats(stats);
        setPageNames(pages);
      }
      
      // Initialize other filters from URL
      const displayFormatParam = searchParams.get('displayFormat') as 'ALL' | 'IMAGE' | 'VIDEO' | null;
      if (displayFormatParam) setDisplayFormat(displayFormatParam);
      
      const pageNameParam = searchParams.get('pageName');
      if (pageNameParam) setSelectedPage(pageNameParam);
      
      const startDateParam = searchParams.get('startDate');
      if (startDateParam) setStartDate(startDateParam);
      
      const endDateParam = searchParams.get('endDate');
      if (endDateParam) setEndDate(endDateParam);
      
      const aiDescriptionParam = searchParams.get('aiDescription');
      if (aiDescriptionParam) setAiDescription(aiDescriptionParam);
      
      const sortByParam = searchParams.get('sortBy');
      if (sortByParam === 'newest' || sortByParam === 'oldest' || sortByParam === 'start_date_asc' || sortByParam === 'start_date_desc') {
        setSortBy(sortByParam);
      }
      
      initialized.current = true;
      setAuthCheckLoading(false);
    })();
  }, [router, searchParams]); // Include router and searchParams

  // Update URL when filters change (after initialization)
  useEffect(() => {
    if (!initialized.current || !businessId) return;
    
    const queryString = buildQueryString({
      businessId: businessId || undefined,
      displayFormat,
      selectedPage,
      startDate,
      endDate,
      aiDescription,
      sortBy,
      currentPage,
      duplicatesRange
    });
    
    const newUrl = queryString ? `/?${queryString}` : '/';
    router.replace(newUrl);
  }, [businessId, displayFormat, selectedPage, startDate, endDate, aiDescription, sortBy, currentPage, duplicatesRange, buildQueryString, router]);
  
  // Fetch page names and duplicates stats when businessId changes
  useEffect(() => {
    if (businessId && initialized.current) {
      (async () => {
        const pages = await fetchPageNames(businessId);
        setPageNames(pages);
        
        const stats = await fetchDuplicatesStats(businessId);
        setDuplicatesStats(stats);
        setDuplicatesRange([stats.min, stats.max]);
      })();
    }
  }, [businessId]);

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const duplicatesFilter = (duplicatesRange[0] > duplicatesStats.min || duplicatesRange[1] < duplicatesStats.max) ? {
      min: duplicatesRange[0],
      max: duplicatesRange[1]
    } : undefined;
    const { ads: data, total } = await fetchAds({
      businessId,
      pageName: selectedPage || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      displayFormat: displayFormat === 'ALL' ? undefined : displayFormat,
      aiDescription: aiDescription || undefined,
      sortBy: sortBy || undefined,
      duplicatesRange: duplicatesFilter
    }, { page: currentPage, perPage: PER_PAGE });
    setAds(data);
    setTotalPages(Math.ceil(total / PER_PAGE));
    setLoading(false);
  }, [businessId, selectedPage, startDate, endDate, displayFormat, aiDescription, currentPage, sortBy, duplicatesRange, duplicatesStats]);

  useEffect(() => { if (businessId) loadData(); }, [loadData, businessId]);

  // Helper functions to check business permissions
  const isOwnedBusiness = (bizId: string) => ownedBusinessIds.includes(bizId);
  const canEditBusiness = (bizId: string) => isAdmin || isOwnedBusiness(bizId);

  if (authCheckLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-white text-zinc-900 selection:bg-zinc-100">
      {/* 1. Header Navigation */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-zinc-100">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-xs font-black tracking-[0.3em] uppercase">Duplicate Tool</span>
          <UserMenu />
        </div>
      </nav>

      <main className="max-w-screen-2xl mx-auto px-6 py-12">
        {/* 2. Top Section: Title & Business Selector */}
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
                if (canEditBusiness(newBizId)) {
                  setBusinessId(newBizId);
                } else {
                  alert('You can only view this business. Contact owner or admin for edit access.');
                }
              }}
              className="h-10 px-4 bg-zinc-50 border border-zinc-100 rounded-lg text-xs font-bold focus:ring-1 focus:ring-zinc-200 outline-none transition-all cursor-pointer"
            >
              {businesses.map(b => {
                const owned = isOwnedBusiness(b.id);
                const canEdit = canEditBusiness(b.id);
                const label = owned ? ` ${b.name || b.slug} (Owner)` : (isAdmin && !owned ? ` ${b.name || b.slug} (Admin)` : ` ${b.name || b.slug}`);
                const suffix = canEdit ? '' : ' (Viewable Only)';
                return <option key={b.id} value={b.id}>{label}{suffix}</option>;
              })}
            </select>
            <Link href={`/setup?returnTo=${encodeURIComponent(`/?${buildQueryString({ businessId: businessId || undefined, displayFormat, selectedPage, startDate, endDate, aiDescription, sortBy, currentPage, duplicatesRange })}`)}`} className="h-10 px-5 bg-zinc-950 text-white rounded-lg flex items-center justify-center font-bold text-xs hover:bg-zinc-800 transition-all shadow-sm">
              Import
            </Link>
          </div>
        </header>

        {/* 3. Filter Bar (Search & Dates) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Page</label>
            <select 
              value={selectedPage} onChange={e => setSelectedPage(e.target.value)}
              className="h-10 px-3 bg-white border border-zinc-200 rounded-lg text-xs outline-none focus:border-zinc-950 transition-colors"
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
              className="h-10 px-4 bg-white border border-zinc-200 rounded-lg text-xs outline-none focus:border-zinc-950 transition-colors"
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

        {/* Duplicates Range Filter */}
        <div className="mb-6 bg-white border border-zinc-200 rounded-lg p-4 max-w-md">
          <div className="flex items-center justify-between mb-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Duplicates</label>
            <span className="text-[10px] font-bold text-zinc-900 tabular-nums">
              {duplicatesRange[0]} - {duplicatesRange[1]}
            </span>
          </div>
          <Slider
            value={duplicatesRange}
            onChange={(_, newValue) => setDuplicatesRange(newValue as [number, number])}
            valueLabelDisplay="auto"
            min={duplicatesStats.min}
            max={duplicatesStats.max}
            sx={{
              color: '#18181b',
              height: 3,
              '& .MuiSlider-thumb': {
                width: 16,
                height: 16,
                '&:hover, &.Mui-focusVisible': {
                  boxShadow: '0 0 0 6px rgba(24, 24, 27, 0.12)',
                },
              },
              '& .MuiSlider-track': {
                height: 3,
              },
              '& .MuiSlider-rail': {
                height: 3,
                opacity: 0.2,
              },
              '& .MuiSlider-valueLabel': {
                fontSize: 10,
                fontWeight: 'bold',
                padding: '4px 6px',
              },
            }}
          />
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-zinc-400 tabular-nums">{duplicatesStats.min}</span>
            <span className="text-[9px] text-zinc-400 tabular-nums">{duplicatesStats.max}</span>
          </div>
        </div>

        {/* 4. CONTENT ACTION BAR (Toggle & Counter) */}
        <div className="flex items-center justify-between py-6 mb-8 border-y border-zinc-50">
          <div className="bg-zinc-50 p-1 rounded-lg border border-zinc-100">
            <ViewToggle value={displayFormat} onChange={setDisplayFormat} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">Results</span>
            <span className="text-xs font-bold tabular-nums">{ads.length}</span>
          </div>
        </div>

        {/* 5. Ads Grid */}
        {loading && ads.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {[...Array(12)].map((_, i) => <div key={i} className="aspect-[3/4] bg-zinc-50 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-24">
            {Array.from(new Set(ads.map(a => a.created_at?.split('T')[0]))).map(date => (
              <section key={date}>
                <div className="flex items-center gap-4 mb-10">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-900">{dayjs(date).format('MMM D, YYYY')}</h2>
                  <div className="h-[1px] flex-1 bg-zinc-100" />
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-12">
                  {ads.filter(a => a.created_at?.startsWith(date)).map((ad, idx) => {
                    const queryString = buildQueryString({
                      businessId: businessId || undefined,
                      displayFormat,
                      selectedPage,
                      startDate,
                      endDate,
                      aiDescription,
                      sortBy,
                      currentPage,
                      duplicatesRange
                    });
                    
                    const returnToUrl = `/?${queryString}`;
                    const viewParams = new URLSearchParams(queryString);
                    viewParams.set('returnTo', returnToUrl);

                    return (
                    <Link key={idx} href={`/view/${ad.ad_archive_id}?${viewParams.toString()}`} className="group block p-3 rounded-xl transition-all duration-500 hover:bg-zinc-50 hover:shadow-2xl hover:shadow-black/15 hover:-translate-y-2 border border-transparent hover:border-zinc-200">
                      <div className="aspect-[3/4] mb-4 overflow-hidden rounded-lg bg-zinc-50">
                        <AdCard ad={ad} />
                      </div>
                      <div className="space-y-2 px-1">
                        <p className="text-[10px] font-black text-zinc-950 truncate uppercase tracking-tight">{ad.page_name}</p>
                        <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter">ID: {ad.ad_archive_id}</p>
                        <div className="text-[9px] text-zinc-500 space-y-1">
                          <div className="flex justify-between">
                            <span className="font-bold">Start:</span>
                            <span>{ad.start_date_formatted?.split(',')[0] || 'N/A'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-bold">End:</span>
                            <span>{ad.end_date_formatted?.split(',')[0] || 'Active'}</span>
                          </div>
                        </div>
                        {ad.ai_description && (
                          <div className="pt-2 border-t border-zinc-100">
                            <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Group Description</p>
                            <p className="text-[9px] text-zinc-600 leading-snug line-clamp-3">
                              {ad.ai_description.replace(/^\*\*|\*\*$/g, '').replace(/^[^\w\s]+|[^\w\s]+$/g, '')}
                            </p>
                          </div>
                        )}
                      </div>
                    </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* 6. Simple Pagination */}
        <footer className="mt-32 py-12 border-t border-zinc-100 flex flex-col items-center">
          <div className="flex items-center gap-6">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="text-[10px] font-black uppercase tracking-widest hover:text-zinc-400 disabled:opacity-10 transition-all">Prev</button>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Page</span>
              <span className="text-xs font-bold">{currentPage} / {totalPages}</span>
            </div>
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="text-[10px] font-black uppercase tracking-widest hover:text-zinc-400 disabled:opacity-10 transition-all">Next</button>
          </div>
        </footer>
      </main>

      <style jsx global>{`
        body { background-color: #ffffff; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #E4E4E7; border-radius: 10px; }
      `}</style>
    </div>
  );
}