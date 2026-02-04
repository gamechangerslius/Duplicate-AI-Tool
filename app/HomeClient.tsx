"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { LocalizationProvider, DatePicker } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { enUS } from "@mui/x-date-pickers/locales";
import { Slider } from "@mui/material";
import dayjs from "dayjs";

// TanStack Query Hooks
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAds } from "@/hooks/useAds";
import { usePageNames } from "@/hooks/usePageNames";
import { useDuplicatesStats } from "@/hooks/useDuplicatesStats";

// Components & Utils
import { isUserAdmin, getUserBusinesses } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/client";
import { AdCard } from "@/components/AdCard";
import { ViewToggle } from "@/components/ViewToggle";
import { UserMenu } from "@/components/UserMenu";

const PER_PAGE = 24;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
});

export default function HomeClient() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocalizationProvider
        dateAdapter={AdapterDayjs}
        localeText={
          enUS.components.MuiLocalizationProvider.defaultProps.localeText
        }
      >
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center bg-white">
              <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
            </div>
          }
        >
          <HomeContent />
        </Suspense>
      </LocalizationProvider>
    </QueryClientProvider>
  );
}

function HomeContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  // States
  const [displayFormat, setDisplayFormat] = useState<"ALL" | "IMAGE" | "VIDEO">("ALL");
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authCheckLoading, setAuthCheckLoading] = useState(true);
  const [ownedBusinessIds, setOwnedBusinessIds] = useState<string[]>([]);
  
  const { data: stats } = useDuplicatesStats(businessId);

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPage, setSelectedPage] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [committedAiDescription, setCommittedAiDescription] = useState("");
  const [duplicatesRange, setDuplicatesRange] = useState<[number, number]>([0, 100]);
  const [committedDuplicatesRange, setCommittedDuplicatesRange] = useState<[number, number]>([0, 100]);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'most_duplicates' | 'least_duplicates'>('newest');
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const pageMenuRef = useRef<HTMLDivElement | null>(null);

  const initialized = useRef(false);
  const lastSelectedBusinessId = useRef<string | null>(null);

  // --- Data Fetching ---
  const adsQuery = useAds({
    businessId,
    pageName: selectedPage || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    displayFormat: displayFormat !== "ALL" ? displayFormat : undefined,
    aiDescription: committedAiDescription || undefined,
    sortBy,
    page: currentPage,
    perPage: PER_PAGE,
    duplicatesRange: {
      min: committedDuplicatesRange[0],
      max: committedDuplicatesRange[1],
    },
  });

  const { data: pageNames = [] } = usePageNames(businessId);
  const pageItems = useMemo(() => {
    return (pageNames || [])
      .map((p: any) => (typeof p === 'string' ? p : p?.name))
      .filter((v: any) => typeof v === 'string' && v.trim().length > 0);
  }, [pageNames]);
  const ads = adsQuery.data?.ads || [];
  const totalPages = Math.ceil((adsQuery.data?.total || 0) / PER_PAGE);
  const isLoading = adsQuery.isLoading || adsQuery.isFetching;

  const groupedDates = useMemo(() => {
    const dates = Array.from(
      new Set(ads.map((a) => (a.group_created_at || a.created_at)?.split("T")[0]).filter(Boolean)),
    );
    return dates.sort((a, b) => dayjs(b).unix() - dayjs(a).unix());
  }, [ads]);

  const formatPeriodDate = (value?: string | null) => {
    if (!value) return '';
    const d = dayjs(value);
    return d.isValid() ? d.format('MMM D, YYYY') : '';
  };

  // 1. Initial Load & URL Sync
  useEffect(() => {
    const init = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAuthCheckLoading(false);
        return;
      }

      const adminStatus = await isUserAdmin(user.id);
      setIsAdmin(adminStatus);

      const bData = await getUserBusinesses(user.id);
      setBusinesses(bData);
      setOwnedBusinessIds(bData.filter((b) => b.owner_id === user.id).map((b) => b.id));

      const initialBizId = searchParams.get("businessId") || (bData.length > 0 ? bData[0].id : null);
      if (!initialBizId) {
        router.replace("/choose-business");
        return;
      }

      // Sync State from URL if exists
      if (searchParams.get("displayFormat")) setDisplayFormat(searchParams.get("displayFormat") as any);
      if (searchParams.get("sortBy")) setSortBy(searchParams.get("sortBy") as any);
      if (searchParams.get("pageName")) setSelectedPage(searchParams.get("pageName")!);
      if (searchParams.get("startDate")) setStartDate(searchParams.get("startDate")!);
      if (searchParams.get("endDate")) setEndDate(searchParams.get("endDate")!);
      if (searchParams.get("aiDescription")) {
        setAiDescription(searchParams.get("aiDescription")!);
        setCommittedAiDescription(searchParams.get("aiDescription")!);
      }
      if (searchParams.get("page")) setCurrentPage(Number(searchParams.get("page")));

      const minD = searchParams.get("minDuplicates");
      const maxD = searchParams.get("maxDuplicates");
      if (minD && maxD) {
        setDuplicatesRange([Number(minD), Number(maxD)]);
        setCommittedDuplicatesRange([Number(minD), Number(maxD)]);
      }

      setBusinessId(initialBizId);
      lastSelectedBusinessId.current = initialBizId;
      initialized.current = true;
      setAuthCheckLoading(false);
    };
    init();
  }, []); // Only on mount

  // 2. Business Change Logic: Reset or Init stats
  useEffect(() => {
    if (!businessId || !stats) return;

    // If business was manually switched
    if (lastSelectedBusinessId.current && lastSelectedBusinessId.current !== businessId) {
      setSelectedPage("");
      setStartDate("");
      setEndDate("");
      setAiDescription("");
      setCommittedAiDescription("");
      setCurrentPage(1);
      setDisplayFormat("ALL");
      
      const range: [number, number] = [0, stats.max];
      setDuplicatesRange(range);
      setCommittedDuplicatesRange(range);
      
      lastSelectedBusinessId.current = businessId;
    } 
    // If this is first load and no range parameters in URL
    else if (initialized.current && !searchParams.get("minDuplicates")) {
        const range: [number, number] = [0, stats.max];
        setDuplicatesRange(range);
        setCommittedDuplicatesRange(range);
    }
  }, [businessId, stats]);

  // 3. Update URL on filter changes
  useEffect(() => {
    if (!initialized.current || !businessId) return;

    const params = new URLSearchParams();
    params.set("businessId", businessId);
    if (displayFormat !== "ALL") params.set("displayFormat", displayFormat);
    if (sortBy !== 'newest') params.set("sortBy", sortBy);
    if (selectedPage) params.set("pageName", selectedPage);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (committedAiDescription) params.set("aiDescription", committedAiDescription);
    if (currentPage > 1) params.set("page", String(currentPage));
    
    params.set("minDuplicates", String(committedDuplicatesRange[0]));
    params.set("maxDuplicates", String(committedDuplicatesRange[1]));

    const newQuery = params.toString();
    const currentQuery = window.location.search.replace(/^\?/, "");
    
    if (newQuery !== currentQuery) {
      router.replace(`/?${newQuery}`, { scroll: false });
    }
  }, [
    businessId,
    displayFormat,
    sortBy,
    selectedPage,
    startDate,
    endDate,
    committedAiDescription,
    currentPage,
    committedDuplicatesRange,
  ]);

  // Close page dropdown on outside click or Escape
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!pageMenuOpen) return;
      const t = e.target as Node;
      if (pageMenuRef.current && !pageMenuRef.current.contains(t)) {
        setPageMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPageMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [pageMenuOpen]);

  // 4. Debounces
  useEffect(() => {
    const t = setTimeout(() => setCommittedAiDescription(aiDescription), 600);
    return () => clearTimeout(t);
  }, [aiDescription]);

  useEffect(() => {
    const t = setTimeout(() => setCommittedDuplicatesRange(duplicatesRange), 600);
    return () => clearTimeout(t);
  }, [duplicatesRange]);

  const isOwnedBusiness = (bizId: string) => ownedBusinessIds.includes(bizId);
  const canEditBusiness = (bizId: string) => isAdmin || isOwnedBusiness(bizId);

  if (authCheckLoading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );

  const filterQuery = {
    businessId: businessId || undefined,
    displayFormat: displayFormat !== "ALL" ? displayFormat : undefined,
    pageName: selectedPage || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    aiDescription: committedAiDescription || undefined,
    page: currentPage > 1 ? String(currentPage) : undefined,
    minDuplicates: String(committedDuplicatesRange[0]),
    maxDuplicates: String(committedDuplicatesRange[1]),
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 selection:bg-zinc-100">
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-zinc-100">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-xs font-black tracking-[0.3em] uppercase">
            Duplicate Tool
          </span>
          <UserMenu />
        </div>
      </nav>

      <main className="max-w-screen-2xl mx-auto px-6 py-12">
        <header className="mb-16 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <h1 className="text-4xl font-light tracking-tight text-zinc-950 mb-2">
              Creative Library
            </h1>
            <p className="text-zinc-400 text-sm font-medium">
              Monitoring digital visual strategies.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={businessId || ""}
              onChange={(e) => {
                const newBizId = e.target.value;
                if (!canEditBusiness(newBizId)) {
                  alert("Access denied.");
                  return;
                }
                setBusinessId(newBizId);
              }}
              className="h-10 px-4 bg-zinc-50 border border-zinc-100 rounded-lg text-xs font-bold outline-none cursor-pointer"
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.slug} {isOwnedBusiness(b.id) ? "(Owner)" : ""}
                </option>
              ))}
            </select>
            <Link
              href="/setup"
              className="h-10 px-5 bg-zinc-950 text-white rounded-lg flex items-center justify-center font-bold text-xs hover:bg-zinc-800 transition-all shadow-sm"
            >
              Import
            </Link>
            {businessId && (
              <a
                href={`/api/export-ads?businessId=${encodeURIComponent(businessId)}${selectedPage?`&pageName=${encodeURIComponent(selectedPage)}`:''}${startDate?`&startDate=${encodeURIComponent(startDate)}`:''}${endDate?`&endDate=${encodeURIComponent(endDate)}`:''}${displayFormat!=="ALL"?`&displayFormat=${encodeURIComponent(displayFormat)}`:''}${committedAiDescription?`&aiDescription=${encodeURIComponent(committedAiDescription)}`:''}&minDuplicates=${encodeURIComponent(String(committedDuplicatesRange[0]))}&maxDuplicates=${encodeURIComponent(String(committedDuplicatesRange[1]))}&format=csv`}
                className="h-10 px-5 bg-white text-zinc-900 rounded-lg flex items-center justify-center font-bold text-xs border border-zinc-200 hover:bg-zinc-50 transition-all shadow-sm"
                target="_blank"
                rel="noopener noreferrer"
              >
                Export
              </a>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="flex flex-col gap-1.5" ref={pageMenuRef}>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">
              Page
            </label>
            <button
              type="button"
              onClick={() => setPageMenuOpen((v) => !v)}
              className="h-10 px-3 bg-white border border-zinc-200 rounded-lg text-xs outline-none focus:border-zinc-950 text-left flex items-center justify-between"
            >
              <span className="truncate">
                {selectedPage ? selectedPage : 'All Pages'}
              </span>
              <span className="ml-2 text-zinc-400">▼</span>
            </button>
            {pageMenuOpen && (
              <div className="relative">
                <div className="absolute z-30 mt-2 w-full bg-white border border-zinc-200 rounded-lg shadow-lg">
                  <div className="max-h-64 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => { setSelectedPage(''); setCurrentPage(1); setPageMenuOpen(false); }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50"
                    >
                      All Pages
                    </button>
                    {pageItems.map((name: string) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { setSelectedPage(name); setCurrentPage(1); setPageMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 ${selectedPage === name ? 'bg-zinc-50 font-bold' : ''}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">
              AI Context
            </label>
            <input
              type="text"
              value={aiDescription}
              onChange={(e) => {
                setAiDescription(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search visual elements..."
              className="h-10 px-4 bg-white border border-zinc-200 rounded-lg text-xs outline-none focus:border-zinc-950"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">
              Start Date
            </label>
            <DatePicker
              value={startDate ? dayjs(startDate) : null}
              onChange={(d) => {
                setStartDate(d?.format("YYYY-MM-DD") || "");
                setCurrentPage(1);
              }}
              slotProps={{
                textField: {
                  size: "small",
                  sx: {
                    "& fieldset": { borderRadius: "8px" },
                    "& .MuiInputBase-root": { fontSize: "12px" },
                  },
                },
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">
              End Date
            </label>
            <DatePicker
              value={endDate ? dayjs(endDate) : null}
              onChange={(d) => {
                setEndDate(d?.format("YYYY-MM-DD") || "");
                setCurrentPage(1);
              }}
              slotProps={{
                textField: {
                  size: "small",
                  sx: {
                    "& fieldset": { borderRadius: "8px" },
                    "& .MuiInputBase-root": { fontSize: "12px" },
                  },
                },
              }}
            />
          </div>
        </div>

        {stats && (
          <div className="mb-6 bg-white border border-zinc-200 rounded-lg p-4 max-w-md">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Duplicates
              </label>
              <span className="text-[10px] font-bold text-zinc-900">
                {duplicatesRange[0]} - {duplicatesRange[1]}
              </span>
            </div>
            <Slider
              value={duplicatesRange}
              onChange={(_, newValue) => {
                setDuplicatesRange(newValue as [number, number]);
                setCurrentPage(1);
              }}
              min={0}
              max={stats.max}
              sx={{ color: "#18181b" }}
            />
          </div>
        )}

        <div className="flex items-center justify-between py-6 mb-8 border-y border-zinc-50">
          <div className="flex items-center gap-6">
            <div className="bg-zinc-50 p-1 rounded-md border border-zinc-100">
              <ViewToggle value={displayFormat} onChange={setDisplayFormat} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Sort group by
              </span>
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value as any); setCurrentPage(1); }}
                className="h-9 px-4 bg-white border border-zinc-200 rounded-md text-[10px] font-black uppercase tracking-widest text-zinc-500 outline-none focus:shadow-sm hover:bg-zinc-50 transition-all"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="most_duplicates">Most duplicates</option>
                <option value="least_duplicates">Least duplicates</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">
              Results
            </span>
            <span className="text-xs font-bold tabular-nums">
              {adsQuery.data?.total || 0}
            </span>
          </div>
        </div>

        {isLoading && ads.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] bg-zinc-50 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-24">
            {groupedDates.map((date) => (
              <section key={date}>
                <div className="flex items-center gap-4 mb-10">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-900">
                    {dayjs(date).format("MMM D, YYYY")}
                  </h2>
                  <div className="h-[1px] flex-1 bg-zinc-100" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-12">
                  {ads
                    .filter((a) => (a.group_created_at || a.created_at)?.startsWith(date))
                    .map((ad) => (
                      <Link
                        key={ad.id}
                        href={{
                          pathname: `/view/${ad.ad_archive_id}`,
                          query: filterQuery,
                        }}
                        className="group block p-3 rounded-xl transition-all duration-500 hover:bg-zinc-50 hover:shadow-2xl border border-transparent hover:border-zinc-200 relative"
                      >
                        <div className="absolute top-5 left-5 z-10">
                          <span className="bg-white/90 backdrop-blur-md border border-zinc-200 text-zinc-900 text-[9px] px-2 py-1 rounded-full font-bold uppercase tracking-tighter shadow-sm">
                            {ad.duplicates_count} duplicates
                          </span>
                        </div>

                        <div className="aspect-[3/4] mb-4 overflow-hidden rounded-lg bg-zinc-50 relative">
                          <AdCard ad={ad} isRefreshing={isLoading} />
                        </div>

                        <div className="space-y-2 px-1">
                          <p className="text-[10px] font-black text-zinc-950 truncate uppercase">
                            {ad.page_name}
                          </p>
                          <p className="text-[9px] font-bold text-zinc-400">
                            ID: {ad.ad_archive_id}
                          </p>

                          {(ad.group_first_seen || ad.group_last_seen || ad.start_date_formatted || ad.end_date_formatted) && (
                            <div className="pt-2">
                              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Period</p>
                              <p className="text-[9px] text-zinc-600">
                                {formatPeriodDate(ad.group_first_seen || ad.start_date_formatted)}
                                {formatPeriodDate(ad.group_first_seen || ad.start_date_formatted) && formatPeriodDate(ad.group_last_seen || ad.end_date_formatted) && ' — '}
                                {formatPeriodDate(ad.group_last_seen || ad.end_date_formatted)}
                              </p>
                            </div>
                          )}

                          {/* {ad.ai_description && (
                            <div className="pt-2">
                              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Group Description</p>
                              <p className="text-[9px] text-zinc-600 leading-snug line-clamp-2">{ad.ai_description.replace(/\*\*|^\W+|\W+$/g, '').slice(0, 140)}</p>
                            </div>
                          )}
                          {ad.concept && (
                            <div className="pt-2">
                              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Concept</p>
                              <p className="text-[9px] text-zinc-700 leading-snug line-clamp-2">{ad.concept}</p>
                            </div>
                          )} */}
                        </div>
                      </Link>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-32 py-12 border-t border-zinc-100 flex flex-col items-center">
          <div className="flex items-center gap-6">
            <button
              disabled={currentPage === 1 || isLoading}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="text-[10px] font-black uppercase tracking-widest disabled:opacity-10"
            >
              Prev
            </button>
            <div className="flex items-center gap-4">
              <span className="text-xs font-bold">
                {currentPage} / {totalPages || 1}
              </span>
            </div>
            <button
              disabled={currentPage >= totalPages || isLoading}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="text-[10px] font-black uppercase tracking-widest disabled:opacity-10"
            >
              Next
            </button>
          </div>
        </footer>
      </main>

      <style jsx global>{`
        body {
          background-color: #ffffff;
        }
        ::-webkit-scrollbar {
          width: 3px;
        }
        ::-webkit-scrollbar-thumb {
          background: #e4e4e7;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}