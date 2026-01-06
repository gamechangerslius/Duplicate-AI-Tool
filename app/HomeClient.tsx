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

import { fetchAds, fetchPageNames, fetchDuplicatesStats } from '@/lib/db';
import type { Ad } from '@/lib/types';
import { AdCard } from '@/components/AdCard';
import { ViewToggle } from '@/components/ViewToggle';

const PER_PAGE = 24;
const HEADWAY_TABLE = 'duplicate_2data_base_blinkist';
const HOLYWATER_TABLE = 'data_base';

type Business = 'Holywater' | 'Headway';
type DisplayFormat = 'ALL' | 'IMAGE' | 'VIDEO';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseDuplicatesParam(
  raw: string | null,
  fallback: [number, number]
): [number, number] {
  if (!raw) return fallback;
  const m = raw.match(/^(\d+)-(\d+)$/);
  if (!m) return fallback;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return fallback;
  return a <= b ? [a, b] : [b, a];
}

/**
 * Normalize niche for DB:
 * - Headway: no niche filter
 * - Holywater: allow "drama" or "passion"
 * - UI might send "romantic novels" -> map to "passion"
 */
function normalizeNicheForDb(business: Business, nicheUi: string): string {
  if (business === 'Headway') return '';
  const s = (nicheUi || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'romantic novels') return 'passion';
  return s;
}

export default function HomeClient() {
  const searchParams = useSearchParams();

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} localeText={enUS.components.MuiLocalizationProvider.defaultProps.localeText}>
      <HomeClientContent searchParams={searchParams} />
    </LocalizationProvider>
  );
}

function HomeClientContent({ searchParams }: { searchParams: ReturnType<typeof useSearchParams> }) {

  // ===== UI display format filter (client-side) =====
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('ALL');

  // ===== Data =====
  const [ads, setAds] = useState<Ad[]>([]);
  const [pageNames, setPageNames] = useState<{ name: string; count: number }[]>([]);

  // ===== Loading flags =====
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // ===== Pagination =====
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // ===== Init guard (so effects don't fire twice with half-initialized state) =====
  const [isInitialized, setIsInitialized] = useState(false);
  const filterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const duplicatesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ===== Filters =====
  const [selectedBusiness, setSelectedBusiness] = useState<Business>('Holywater');
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [selectedNiche, setSelectedNiche] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  /**
   * Duplicates slider model (proper UX):
   * - stats = min/max boundaries from DB
   * - draft = what user moves on slider (does NOT trigger queries)
   * - applied = what is used in queries
   * - dupsDirty = draft changed but not applied yet
   * - dupsEverApplied = user clicked apply at least once (when false => treat as "no duplicates filter")
   */
  const [duplicatesStats, setDuplicatesStats] = useState<{ min: number; max: number }>({
    min: 0,
    max: 0,
  });
  const [duplicatesRangeDraft, setDuplicatesRangeDraft] = useState<[number, number]>([0, 0]);
  const [duplicatesRangeApplied, setDuplicatesRangeApplied] = useState<[number, number]>([0, 0]);
  const [dupsDirty, setDupsDirty] = useState(false);
  const [dupsEverApplied, setDupsEverApplied] = useState(false);

  // ===== Helpers =====
  const tableName = selectedBusiness === 'Headway' ? HEADWAY_TABLE : HOLYWATER_TABLE;

  /**
   * Update URL params (without pushing history).
   * Note: we intentionally only include duplicates when the user has applied them.
   */
  const updateUrlParams = useCallback(
    (next: {
      business: Business;
      page: string;
      niche: string;
      format?: DisplayFormat;
      startDate?: string;
      endDate?: string;
      duplicatesApplied?: [number, number] | null; // null/undefined => remove param
    }) => {
      const params = new URLSearchParams();

      if (next.business !== 'Holywater') params.set('business', next.business);
      if (next.page) params.set('page', next.page);

      // Only include niche if meaningful (non-empty string)
      if (next.niche && next.niche.trim()) params.set('niche', next.niche);

      // Persist display format when not default
      if (next.format && next.format !== 'ALL') params.set('format', next.format);

      // Date filters
      if (next.startDate) params.set('startDate', next.startDate);
      if (next.endDate) params.set('endDate', next.endDate);

      // Only include duplicates if applied
      if (next.duplicatesApplied) {
        params.set('duplicates', `${next.duplicatesApplied[0]}-${next.duplicatesApplied[1]}`);
      }

      const newUrl = params.toString() ? `?${params.toString()}` : '/';
      window.history.replaceState({}, '', newUrl);
    },
    []
  );

  /**
   * Load page names for the selected business/table.
   */
  const loadPageNames = useCallback(async () => {
    const pages = await fetchPageNames(tableName);
    setPageNames(pages);
  }, [tableName]);

  /**
   * Load duplicates stats (min/max) for current business/page/niche.
   * If duplicates were never applied, we default the draft+applied range to full stats.
   * If duplicates were applied, we clamp ranges into new bounds.
   */
  const loadStats = useCallback(async () => {
    const nicheForDb = normalizeNicheForDb(selectedBusiness, selectedNiche) || undefined;

    const stats = await fetchDuplicatesStats(
      selectedBusiness,
      selectedPage,
      selectedBusiness === 'Headway' ? undefined : nicheForDb,
      {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        displayFormat,
      }
    );

    setDuplicatesStats(stats);

    // If user never applied duplicates filter, keep UX simple: default to full range.
    if (!dupsEverApplied) {
      setDuplicatesRangeDraft([stats.min, stats.max]);
      setDuplicatesRangeApplied([stats.min, stats.max]);
      setDupsDirty(false);
      return;
    }

    // If user applied before, clamp current values into new bounds.
    setDuplicatesRangeApplied(([a, b]) => [
      clamp(a, stats.min, stats.max),
      clamp(b, stats.min, stats.max),
    ]);
    setDuplicatesRangeDraft(([a, b]) => [
      clamp(a, stats.min, stats.max),
      clamp(b, stats.min, stats.max),
    ]);
  }, [selectedBusiness, selectedPage, selectedNiche, startDate, endDate, displayFormat, dupsEverApplied]);

  const buildDuplicatesFilter = useCallback(() => {
    if (!dupsEverApplied) return { min: 0, max: 999999 };
    return { min: duplicatesRangeApplied[0], max: duplicatesRangeApplied[1] };
  }, [dupsEverApplied, duplicatesRangeApplied]);

  /**
   * Load first page of ads for current filters.
   */
  const loadAds = useCallback(async () => {
    setLoading(true);

    const nicheForDbRaw = normalizeNicheForDb(selectedBusiness, selectedNiche);
    const nicheForDb = nicheForDbRaw ? nicheForDbRaw : undefined;

    const { ads: data, total } = await fetchAds(
      {
        business: selectedBusiness,
        pageName: selectedPage || undefined,
        duplicatesRange: buildDuplicatesFilter(),
        competitorNiche: selectedBusiness === 'Headway' ? undefined : nicheForDb,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      },
      { page: 1, perPage: PER_PAGE }
    );

    setAds(data);
    setTotalPages(Math.ceil(total / PER_PAGE));
    setCurrentPage(1);
    setLoading(false);
  }, [selectedBusiness, selectedPage, selectedNiche, startDate, endDate, buildDuplicatesFilter]);

  /**
   * Load next page of ads.
   */
  const loadMoreAds = useCallback(async () => {
    setLoadingMore(true);

    const nicheForDbRaw = normalizeNicheForDb(selectedBusiness, selectedNiche);
    const nicheForDb = nicheForDbRaw ? nicheForDbRaw : undefined;

    const { ads: data, total } = await fetchAds(
      {
        business: selectedBusiness,
        pageName: selectedPage || undefined,
        duplicatesRange: buildDuplicatesFilter(),
        competitorNiche: selectedBusiness === 'Headway' ? undefined : nicheForDb,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      },
      { page: currentPage + 1, perPage: PER_PAGE }
    );

    setAds((prev) => [...prev, ...data]);
    setCurrentPage((prev) => prev + 1);
    setTotalPages(Math.ceil(total / PER_PAGE));
    setLoadingMore(false);
  }, [selectedBusiness, selectedPage, selectedNiche, currentPage, startDate, endDate, buildDuplicatesFilter]);

  // ===== Init filters from URL (once searchParams are available) =====
  useEffect(() => {
    const business = (searchParams.get('business') as Business) || 'Holywater';
    const pageName = searchParams.get('page') || '';
    const niche = searchParams.get('niche') || '';
    const fmt = (searchParams.get('format') as DisplayFormat) || 'ALL';
    const start = searchParams.get('startDate') || '';
    const end = searchParams.get('endDate') || '';

    setSelectedBusiness(business);
    setSelectedPage(pageName);
    setSelectedNiche(niche);
    setDisplayFormat(fmt === 'IMAGE' || fmt === 'VIDEO' ? fmt : 'ALL');
    setStartDate(start);
    setEndDate(end);

    // duplicates param is optional; we can only safely apply it AFTER stats are loaded.
    // So here we just mark initialized and handle duplicates param later when stats arrive.
    setIsInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ===== Load page names when business changes =====
  useEffect(() => {
    loadPageNames();
  }, [loadPageNames]);

  // ===== Reset niche & duplicates UX when switching business (for Headway niche rules) =====
  useEffect(() => {
    // Reset only niche and duplicates; keep page/format unless user changed via UI
    setSelectedNiche('');
    setDupsEverApplied(false);
    setDupsDirty(false);
  }, [selectedBusiness]);

  // ===== Load duplicates stats when business/page/niche change =====
  useEffect(() => {
    // Fetch slider bounds only after the current ads batch has finished loading
    if (!isInitialized || loading) return;
    loadStats();
  }, [isInitialized, loading, loadStats]);

  // Apply duplicates from URL immediately (raw) so back navigation keeps the selected range.
  useEffect(() => {
    if (!isInitialized) return;
    const raw = searchParams.get('duplicates');
    if (!raw) return;

    const parsed = parseDuplicatesParam(raw, duplicatesRangeDraft);
    setDuplicatesRangeDraft(parsed);
    setDuplicatesRangeApplied(parsed);
    setDupsEverApplied(true);
    setDupsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, searchParams]);

  /**
   * Apply duplicates from URL AFTER stats are known.
   * This ensures URL "duplicates=10-200" gets clamped properly into stats range.
   */
  useEffect(() => {
    if (!isInitialized) return;
    const raw = searchParams.get('duplicates');
    if (!raw) return;

    // We can only apply if stats look valid
    if (duplicatesStats.max <= duplicatesStats.min) return;

    const parsed = parseDuplicatesParam(raw, [duplicatesStats.min, duplicatesStats.max]);
    const clamped: [number, number] = [
      clamp(parsed[0], duplicatesStats.min, duplicatesStats.max),
      clamp(parsed[1], duplicatesStats.min, duplicatesStats.max),
    ];

    // Set as applied (since URL explicitly has duplicates)
    setDuplicatesRangeDraft(clamped);
    setDuplicatesRangeApplied(clamped);
    setDupsEverApplied(true);
    setDupsDirty(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, duplicatesStats.min, duplicatesStats.max]);

  /**
   * Auto-apply duplicates slider changes after user stops dragging (debounced).
   */
  useEffect(() => {
    if (!isInitialized || !dupsDirty) return;

    if (duplicatesTimeoutRef.current) clearTimeout(duplicatesTimeoutRef.current);

    duplicatesTimeoutRef.current = setTimeout(() => {
      // Auto-apply draft to applied
      setDuplicatesRangeApplied(duplicatesRangeDraft);
      setDupsDirty(false);
      setDupsEverApplied(true);
    }, 400); // 400ms delay after user stops moving slider

    return () => {
      if (duplicatesTimeoutRef.current) clearTimeout(duplicatesTimeoutRef.current);
    };
  }, [duplicatesRangeDraft, dupsDirty, isInitialized]);

  /**
   * Auto-load ads when filters change (business/page/niche/dates) OR duplicates range changes.
   */
  useEffect(() => {
    if (!isInitialized) return;

    if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current);

    filterTimeoutRef.current = setTimeout(() => {
      loadAds();

      // Update URL
      updateUrlParams({
        business: selectedBusiness,
        page: selectedPage,
        niche: selectedNiche,
        format: displayFormat,
        startDate,
        endDate,
        duplicatesApplied: dupsEverApplied ? duplicatesRangeApplied : null,
      });
    }, 300);

    return () => {
      if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current);
    };
  }, [
    isInitialized,
    selectedBusiness,
    selectedPage,
    selectedNiche,
    startDate,
    endDate,
    duplicatesRangeApplied,
    dupsEverApplied,
    loadAds,
    updateUrlParams,
    displayFormat,
  ]);

  // ===== Client-side format filter =====
  const filteredAds = useMemo(() => {
    if (displayFormat === 'ALL') return ads;
    return ads.filter((ad) => ad.display_format === displayFormat);
  }, [ads, displayFormat]);

  // Persist display format in URL without reloading data
  useEffect(() => {
    if (!isInitialized) return;
    updateUrlParams({
      business: selectedBusiness,
      page: selectedPage,
      niche: selectedNiche,
      format: displayFormat,
      startDate,
      endDate,
      duplicatesApplied: dupsEverApplied ? duplicatesRangeApplied : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayFormat]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Ad Gallery</h1>
          <p className="text-slate-600">Browse creative advertisements</p>

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
            <label className="block text-sm font-medium text-slate-700 mb-2">Genesis Business</label>
            <select
              value={selectedBusiness}
              onChange={(e) => {
                const next = e.target.value as Business;
                // Switch business and reset all filters via user action
                setSelectedBusiness(next);
                setSelectedPage('');
                setSelectedNiche('');
                setDisplayFormat('ALL');
                setStartDate('');
                setEndDate('');
                setDupsEverApplied(false);
                setDupsDirty(false);

                // Immediately reflect new base params in URL
                updateUrlParams({
                  business: next,
                  page: '',
                  niche: '',
                  format: 'ALL',
                  startDate: '',
                  endDate: '',
                  duplicatesApplied: null,
                });
              }}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
            >
              <option value="Holywater">Holywater</option>
              <option value="Headway">Headway</option>
            </select>
          </div>

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
              disabled={selectedBusiness === 'Headway'}
            >
              {selectedBusiness === 'Headway' ? (
                <option value="">All available</option>
              ) : (
                <>
                  <option value="">All</option>
                  <option value="drama">Drama</option>
                  {/* store DB-native value to avoid extra mapping issues */}
                  <option value="passion">Romantic novels</option>
                </>
              )}
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
                      '&:hover': {
                        borderColor: '#94a3b8',
                      },
                      '&.Mui-focused': {
                        backgroundColor: '#f8fafc',
                      },
                    },
                    '& .MuiInputBase-input': {
                      color: '#0f172a',
                      fontSize: '0.875rem',
                    },
                    '& .MuiInputLabel-root': {
                      color: '#475569',
                      fontSize: '0.875rem',
                    },
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
                      '&:hover': {
                        borderColor: '#94a3b8',
                      },
                      '&.Mui-focused': {
                        backgroundColor: '#f8fafc',
                      },
                    },
                    '& .MuiInputBase-input': {
                      color: '#0f172a',
                      fontSize: '0.875rem',
                    },
                    '& .MuiInputLabel-root': {
                      color: '#475569',
                      fontSize: '0.875rem',
                    },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* ===== Proper duplicates range slider (draft + apply) ===== */}
        {duplicatesStats.max > duplicatesStats.min && (
          <div className="mb-6 max-w-md">
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
                    // Auto-apply happens via useEffect with debounce
                  }}
                  onChangeCommitted={(_e, newValue) => {
                    const v = newValue as [number, number];
                    setDuplicatesRangeDraft(v);
                    setDuplicatesRangeApplied(v);
                    setDupsDirty(false);
                    setDupsEverApplied(true);

                    // Persist immediately so back navigation keeps the range
                    updateUrlParams({
                      business: selectedBusiness,
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
                    '& .MuiSlider-thumb': {
                      height: 16,
                      width: 16,
                    },
                    '& .MuiSlider-track': {
                      height: 5,
                    },
                    '& .MuiSlider-rail': {
                      height: 5,
                    },
                  }}
                />

                <Typography
                  variant="caption"
                  sx={{ color: '#64748b', minWidth: '24px', textAlign: 'right' }}
                >
                  {duplicatesStats.max}
                </Typography>
              </Box>
            </Box>
          </div>
        )}

        {/* ===== View toggle (ALL/IMAGE/VIDEO) ===== */}
        <ViewToggle value={displayFormat} onChange={setDisplayFormat} />

        {/* ===== Grid ===== */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {filteredAds.map((ad) => (
            <Link
              key={ad.id}
              href={`/view/${ad.ad_archive_id}?business=${selectedBusiness}&page=${selectedPage}${
                dupsEverApplied
                  ? `&duplicates=${duplicatesRangeApplied[0]}-${duplicatesRangeApplied[1]}`
                  : ''
              }${selectedNiche ? `&niche=${selectedNiche}` : ''}${
                displayFormat !== 'ALL' ? `&format=${displayFormat}` : ''
              }${startDate ? `&startDate=${startDate}` : ''}${endDate ? `&endDate=${endDate}` : ''}`}
            >
              <AdCard ad={ad} />
            </Link>
          ))}
        </div>

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

        {/* ===== Load more ===== */}
        {currentPage < totalPages && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={loadMoreAds}
              disabled={loadingMore}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              {loadingMore ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
