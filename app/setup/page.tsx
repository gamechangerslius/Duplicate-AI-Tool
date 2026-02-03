"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
// SSE log hook
function useSSELogs(base: string, taskId: string | null, onLog: (msg: string) => void) {
  useEffect(() => {
    if (!taskId) return;
    const evtSource = new EventSource(`/api/${base}/logs/${taskId}`);
    evtSource.onmessage = (event) => {
      onLog(event.data);
    };
    return () => evtSource.close();
  }, [base, taskId, onLog]);
}
import React from "react";
import { createClient } from '@/utils/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { isUserAdmin, getUserBusinesses } from '@/utils/supabase/admin';

type LinkRow = { id: string; url: string; maxAds: number };
type Business = { id: string; slug: string; name?: string; owner_id?: string };

const uid = () => Math.random().toString(36).slice(2, 10);

export default function SetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/';
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<LinkRow[]>([{ id: uid(), url: '', maxAds: 100 }]);
  const [sending, setSending] = useState(false);
  const [importStopped, setImportStopped] = useState(false);
  const [maxAdsGlobal, setMaxAdsGlobal] = useState(100);
  const [jsonConfirm, setJsonConfirm] = useState<{ items: any[]; fileName: string }|null>(null);
  const [jsonFiles, setJsonFiles] = useState<File[] | null>(null);
  const [importTaskId, setImportTaskId] = useState<string | null>(null);
  const [forwardTaskId, setForwardTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const [businessesLoading, setBusinessesLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ownedBusinessIds, setOwnedBusinessIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<Array<{ id: string; type: 'success' | 'error' | 'info'; message: string; timestamp: number }>>([]);
  const [autoImport, setAutoImport] = useState(true);

  useEffect(() => {
    const initUser = async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id ?? null;
      setUserId(userId);
      if (userId) {
        const adminStatus = await isUserAdmin(userId);
        setIsAdmin(adminStatus);
        const userBusinesses = await getUserBusinesses(userId);
        if (userBusinesses && userBusinesses.length > 0) {
          const typedBiz = userBusinesses as Business[];
          setBusinesses(typedBiz);
          setSelectedBusinessId(typedBiz[0].id);
          // Track which businesses user owns (owner_id === userId)
          const ownedIds = typedBiz
            .filter(b => b.owner_id === userId)
            .map(b => b.id);
          setOwnedBusinessIds(ownedIds);
        }
      }
      setBusinessesLoading(false);
    };
    initUser();
  }, [supabase]);

  // Determine if user can setup the selected business
  const canSetupSelected = useMemo(() => {
    if (!selectedBusinessId) return false;
    // Owner can setup their own business
    if (ownedBusinessIds.includes(selectedBusinessId)) return true;
    // Admin can setup any business
    if (isAdmin) return true;
    // Regular user cannot setup
    return false;
  }, [selectedBusinessId, ownedBusinessIds, isAdmin]);

  // Check if business is owned by current user
  const isOwnedBusiness = (bizId: string) => ownedBusinessIds.includes(bizId);

  // Check if business is accessible to admin but not owned
  const isAdminAccessOnly = (bizId: string) => isAdmin && !isOwnedBusiness(bizId);

  const isLikelyMetaAds = useCallback((u: string) => {
    try {
      const host = new URL(u).hostname.toLowerCase();
      return host.includes('facebook') || host.includes('meta') || host.includes('ads');
    } catch { return false; }
  }, []);



  const addRow = () => setRows(rs => [...rs, { id: uid(), url: '', maxAds: maxAdsGlobal }]);
  const removeRow = (id: string) => setRows(rs => (rs.length > 1 ? rs.filter(x => x.id !== id) : rs));
  const updateRow = (id: string, url: string) => setRows(rs => rs.map(x => (x.id === id ? { ...x, url } : x)));
  const updateRowMax = (id: string, maxAds: number) => setRows(rs => rs.map(x => (x.id === id ? { ...x, maxAds } : x)));
  const updateAllMaxAds = (val: number) => setRows(rs => rs.map(x => ({ ...x, maxAds: val })));

  // Load saved Apify links for current user & business
  useEffect(() => {
    const loadSaved = async () => {
      if (!selectedBusinessId) return;
      try {
        const res = await fetch(`/api/apify-links?businessId=${encodeURIComponent(selectedBusinessId)}&scope=mine`, { cache: 'no-store' });
        const js = await res.json().catch(() => ({ items: [] }));
        if (Array.isArray(js.items) && js.items.length) {
          setRows(js.items.map((i: any) => ({ id: i.id || uid(), url: i.url || '', maxAds: Number(i.maxAds) || maxAdsGlobal })));
          addLog('info', `📦 Loaded ${js.items.length} saved link(s)`);
        }
      } catch {}
    };
    loadSaved();
  }, [selectedBusinessId]);

  // Persist current list for user & business
  const saveLinks = async () => {
    if (!selectedBusinessId) return;
    const payload = rows.filter(r => r.url.trim()).map(r => ({ url: r.url.trim(), maxAds: Number(r.maxAds) || maxAdsGlobal }));
    try {
      const res = await fetch('/api/apify-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: selectedBusinessId, links: payload })
      });
      if (!res.ok) throw new Error('Save failed');
      const js = await res.json().catch(() => ({}));
      addLog('success', `💾 Saved ${js.count ?? payload.length} link(s)`);
    } catch (e: any) {
      addLog('error', `❌ Save failed: ${e?.message || 'error'}`);
    }
  };

  const clearMyLinks = async () => {
    if (!selectedBusinessId) return;
    try {
      const res = await fetch(`/api/apify-links?businessId=${encodeURIComponent(selectedBusinessId)}&all=1`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setRows([{ id: uid(), url: '', maxAds: maxAdsGlobal }]);
      addLog('success', '🗑️ Cleared your saved links');
    } catch (e: any) { addLog('error', `❌ ${e?.message || 'Delete failed'}`); }
  };

  const clearAllBusinessLinks = async () => {
    if (!selectedBusinessId || !isAdmin) return;
    try {
      const res = await fetch(`/api/apify-links?businessId=${encodeURIComponent(selectedBusinessId)}&allBusiness=1`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setRows([{ id: uid(), url: '', maxAds: maxAdsGlobal }]);
      addLog('success', '🗑️ Cleared all links for business');
    } catch (e: any) { addLog('error', `❌ ${e?.message || 'Delete failed'}`); }
  };

  // JSON upload handler (import-json API with confirm)
  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    addLog('info', '📁 Reading JSON file(s)...');
    const files = Array.from(e.target.files || []);
    if (!files.length || !selectedBusinessId) return;
    try {
      // Read all files as text and parse JSON
      const parsed = await Promise.all(files.map(async (file) => {
        const txt = await file.text();
        const json = JSON.parse(txt);
        if (!Array.isArray(json)) throw new Error(`${file.name} is not a JSON array`);
        return { name: file.name, items: json };
      }));

      const total = parsed.reduce((s, p) => s + (p.items?.length || 0), 0);
      if (total === 0) {
        addLog('error', '❌ JSON files contain no items');
        e.target.value = '';
        return;
      }
      const combined = parsed.flatMap(p => p.items || []);
      addLog('info', `✅ Parsed ${total} creatives from ${files.length} file(s). Awaiting confirmation...`);
      setJsonFiles(files);
      setJsonConfirm({ items: combined, fileName: parsed.map(p => p.name).join(', ') });
    } catch (err) {
      addLog('error', `❌ Failed to parse JSON: ${(err && (err as any).message) || String(err)}`);
    } finally {
      e.target.value = '';
    }
  };

  // CSV upload handler - parses CSV and extracts URLs and optional maxAds column
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    addLog('info', '📁 Reading CSV file...');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || '');
        // Split into lines and parse simple CSV (commas, optional header)
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
          addLog('error', '❌ CSV is empty');
          return;
        }
        // Detect header - common names: url, link, max, maxAds
        const firstCols = lines[0].split(',').map(c => c.trim().toLowerCase());
        let startIdx = 0;
        let hasHeader = false;
        if (firstCols.includes('url') || firstCols.includes('link') || firstCols.includes('ad_url')) {
          hasHeader = true;
          startIdx = 1;
        }

        const parsed: LinkRow[] = [];
        for (let i = startIdx; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim()).filter(Boolean);
          if (cols.length === 0) continue;
          let url = cols[0];
          let max = maxAdsGlobal;
          // If header present and has maxads column name, find its index
          if (hasHeader) {
            const urlIdx = firstCols.indexOf('url') >= 0 ? firstCols.indexOf('url') : 0;
            const maxIdx = firstCols.indexOf('maxads') >= 0 ? firstCols.indexOf('maxads') : (firstCols.indexOf('max') >= 0 ? firstCols.indexOf('max') : -1);
            url = (cols[urlIdx] || cols[0]) as string;
            if (maxIdx >= 0 && cols[maxIdx]) max = Number(cols[maxIdx]) || maxAdsGlobal;
          } else {
            // No header — assume first col is url, second optional max
            url = cols[0];
            if (cols[1]) max = Number(cols[1]) || maxAdsGlobal;
          }
          parsed.push({ id: uid(), url, maxAds: max });
        }

        if (parsed.length === 0) {
          addLog('error', '❌ No valid rows found in CSV');
          return;
        }
        setRows(parsed.map(p => ({ id: p.id, url: p.url, maxAds: p.maxAds ?? maxAdsGlobal })));
        addLog('success', `✅ Parsed ${parsed.length} rows from CSV`);
      } catch (err) {
        addLog('error', '❌ Failed to parse CSV');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // JSON import confirmation
  const confirmJsonImport = async () => {
    if (!jsonConfirm || !selectedBusinessId) return;
    setSending(true);
    setImportStopped(false);
    setJsonConfirm(null);
    // Generate taskId (can replace with uuid or server id)
    const taskId = `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setImportTaskId(taskId);
    addLog('info', `⏳ Sending creatives to server for import (taskId: ${taskId})...`);
    try {
      if (!jsonFiles || jsonFiles.length === 0) {
        // fallback: send items as JSON if files missing
        const items = jsonConfirm?.items.slice(0, maxAdsGlobal) || [];
        const res = await fetch('/api/import-json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, businessId: selectedBusinessId, maxAds: maxAdsGlobal, taskId })
        });
        if (!res.ok) throw new Error('Import failed');
      } else {
        const fd = new FormData();
        jsonFiles.slice(0, 20).forEach((f) => fd.append('files', f));
        fd.append('businessId', selectedBusinessId as string);
        fd.append('maxAds', String(maxAdsGlobal));
        fd.append('taskId', taskId);
        const res = await fetch('/api/import-json', {
          method: 'POST',
          body: fd
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Import failed' }));
          throw new Error(err.message || 'Import failed');
        }
      }
      addLog('success', '✅ Import started! Creatives are being processed and will appear in the gallery soon.');
      setSuccessMsg('JSON imported to DB. Creatives will appear after processing.');
    } catch (e) {
      addLog('error', `❌ Import failed: ${(e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e)}`);
      setError((e as any)?.message || 'Import failed');
    } finally {
      setSending(false);
      setJsonFiles(null);
    }
  };

  // Stop import handler
  const stopImport = async () => {
    if (!importTaskId) return;
    setImportStopped(true);
    setSending(false);
    addLog('info', '⏹️ Sending stop request...');
    try {
      await fetch('/api/import-json/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: importTaskId })
      });
      addLog('info', '⏹️ Import stop requested. The process will halt soon.');
      setTimeout(() => {
        router.refresh();
      }, 1000);
    } catch (e) {
      addLog('error', '❌ Failed to send stop request');
    }
  };
  // Subscribe to SSE logs for import-json taskId
  useSSELogs('import-json', importTaskId, (msg) => {
    if (msg.includes('⏹️ Import cancelled by user.')) {
      setImportStopped(true);
      setSending(false);
      addLog('info', msg);
    } else {
      addLog('info', msg);
    }
  });

  // Subscribe to SSE logs for forward-webhook (parser)
  useSSELogs('forward-webhook', forwardTaskId, (msg) => {
    if (msg.includes('⏹️')) {
      setImportStopped(true);
      setSending(false);
      addLog('info', msg);
    } else {
      addLog('info', msg);
    }
  });

  const addLog = (type: 'success' | 'error' | 'info', message: string) => {
    setLogs(prev => [{ id: uid(), type, message, timestamp: Date.now() }, ...prev].slice(0, 20));
  };

  const handlePasteBulk = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const candidates = text.split(/\r?\n|\s+/).map(t => t.trim()).filter(Boolean);
      if (!candidates.length) return;
      setRows(candidates.map(u => ({ id: uid(), url: u, maxAds: 50 })));
      addLog('success', `📋 Pasted ${candidates.length} links`);
    } catch { addLog('error', '❌ Clipboard access denied'); }
  };

  const nonEmptyUrls = useMemo(() => rows.map(r => r.url.trim()).filter(Boolean), [rows]);

  const onSend = async () => {
    setError(null); setSuccessMsg(null);
    if (!nonEmptyUrls.length || !selectedBusinessId) return;
    
    // Check permission
    if (!canSetupSelected) {
      setError('You do not have permission to setup this business. Only the owner or admins can setup.');
      addLog('error', '❌ Access denied - insufficient permissions for this business');
      return;
    }
    
    // generate a forward taskId and subscribe to logs
    const taskId = `fw_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setForwardTaskId(taskId);
    setSending(true);
    addLog('info', `🚀 Starting scrape for ${nonEmptyUrls.length} links... (task ${taskId})`);
    
    try {
      const linksPayload = rows
        .map(r => ({ url: r.url.trim(), maxAds: Number.isFinite(r.maxAds) ? Number(r.maxAds) : 50 }))
        .filter(r => r.url);

      const res = await fetch('/api/forward-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          links: linksPayload, 
          businessId: selectedBusinessId, 
          autoImport: autoImport,
          taskId 
        })
      });
      if (!res.ok) throw new Error('Request failed');
      addLog('success', '✅ Data sent to Apify successfully');
      setSuccessMsg('Task started!');
    } catch (e: any) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? e.message : String(e);
      addLog('error', `❌ Error: ${msg}`);
      setError(msg);
    } finally { setSending(false); }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => router.push(returnTo)} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-2">
            ← Back to Gallery
          </button>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">Scraper Setup</h1>
          <div className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wider">
            {nonEmptyUrls.length} links ready
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Card 1: Configuration */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 transition-all hover:shadow-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-500 rounded-lg text-white">⚙️</div>
                <h2 className="text-lg font-bold">General Configuration</h2>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Select Business</label>
                  <select 
                    value={selectedBusinessId || ''} 
                    onChange={(e) => setSelectedBusinessId(e.target.value)}
                    className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                  >
                    <option value="">Choose a business...</option>
                    {businesses.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.slug}
                        {isOwnedBusiness(b.id) ? ' (Owner)' : ''}
                        {isAdminAccessOnly(b.id) ? ' (Admin)' : ''}
                      </option>
                    ))}
                  </select>
                  
                  {/* Access Info */}
                  {selectedBusinessId && (
                    <div className={`mt-2 p-3 rounded-lg text-sm ${
                      canSetupSelected
                        ? 'bg-green-50 text-green-800 border border-green-200'
                        : 'bg-red-50 text-red-800 border border-red-200'
                    }`}>
                      {isOwnedBusiness(selectedBusinessId) && (
                        <span>✓ You own this business</span>
                      )}
                      {isAdminAccessOnly(selectedBusinessId) && (
                        <span>✓ Admin access enabled</span>
                      )}
                      {!canSetupSelected && (
                        <span>✗ No setup permission for this business</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Auto-import toggle */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Auto-import</label>
                  <div className="h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center">
                    <button
                      onClick={() => setAutoImport(!autoImport)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                        autoImport ? 'bg-indigo-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                          autoImport ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className="ml-3 text-sm font-semibold text-slate-700">
                      {autoImport ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {autoImport 
                      ? 'Creatives will be automatically imported to database'
                      : 'Creatives will only be scraped (manual import needed)'}
                  </p>
                </div>
              </div>
            </section>

            {/* Card 2: Links Management */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h2 className="text-lg font-bold flex items-center gap-2">🔗 Source Links</h2>
                <div className="flex flex-wrap gap-2 items-center justify-end max-w-full">
                  <input
                    type="number"
                    min={1}
                    max={99999}
                    value={maxAdsGlobal}
                    onChange={e => {
                      const val = Math.max(1, Math.min(99999, Number(e.target.value)));
                      setMaxAdsGlobal(val);
                      updateAllMaxAds(val);
                    }}
                    className="w-24 px-2 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-300 focus:bg-white transition-all mr-2"
                    placeholder="Max creatives"
                  />
                        {/* JSON Import Confirmation Modal */}
                        {jsonConfirm && (
                          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full border border-slate-100 animate-in fade-in slide-in-from-top-8">
                              <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-indigo-500 rounded-lg text-white text-xl shadow-lg"><svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M12 3v14m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><rect x="3" y="17" width="18" height="4" rx="2" fill="#6366f1" opacity=".1"/></svg></div>
                                <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Confirm JSON Import</h2>
                              </div>
                              <div className="space-y-3 text-base text-slate-700">
                                <div>
                                  <span className="font-semibold text-slate-500">Files:</span>
                                  <div className="mt-2 max-h-40 overflow-auto bg-slate-50 p-2 rounded-md border border-slate-100">
                                    {jsonConfirm.fileName.split(',').map((name, i) => (
                                      <div key={i} className="text-sm font-mono text-indigo-700 break-words py-0.5">{name.trim()}</div>
                                    ))}
                                  </div>
                                </div>
                                <div><span className="font-semibold text-slate-500">Total creatives in file:</span> <span className="font-bold text-slate-900">{jsonConfirm.items.length}</span></div>
                                <div><span className="font-semibold text-slate-500">Will be imported:</span> <span className="font-bold text-indigo-600">{Math.min(jsonConfirm.items.length, maxAdsGlobal)}</span></div>
                                <div className="break-all"><span className="font-semibold text-slate-500">Business:</span> <span className="font-bold text-slate-900 break-all inline-block max-w-full align-middle">{businesses.find(b => b.id === selectedBusinessId)?.name || selectedBusinessId}</span></div>
                              </div>
                                <div className="flex gap-4 mt-8 justify-end">
                                <button onClick={() => { setJsonConfirm(null); setJsonFiles(null); }} className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 border border-slate-200 shadow-sm transition-all">Cancel</button>
                                <button onClick={confirmJsonImport} className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-lg transition-all" disabled={sending || importStopped}>Import</button>
                              </div>
                            </div>
                          </div>
                        )}
                  <button onClick={handlePasteBulk} className="h-10 px-4 text-xs font-bold whitespace-nowrap bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
                    Paste Clipboard
                  </button>
                  <button onClick={addRow} className="h-10 px-4 text-xs font-bold whitespace-nowrap bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                    + Add New
                  </button>
                  <label className="h-10 px-4 text-xs font-bold whitespace-nowrap bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm cursor-pointer flex items-center">
                    Upload JSON
                    <input type="file" accept="application/json" multiple onChange={handleJsonUpload} className="hidden" />
                  </label>
                  <label className="h-10 px-4 text-xs font-bold whitespace-nowrap bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm cursor-pointer flex items-center">
                    Upload CSV
                    <input type="file" accept="text/csv,.csv" onChange={handleCsvUpload} className="hidden" />
                  </label>
                  <button onClick={saveLinks} className="h-10 px-4 text-xs font-bold whitespace-nowrap bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm">Save Links</button>
                  <button onClick={clearMyLinks} className="h-10 px-4 text-xs font-bold whitespace-nowrap bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">Clear My Links</button>
                  {isAdmin && (
                    <button
                      onClick={clearAllBusinessLinks}
                      title="Clear all saved links for this business (admin only)"
                      className="h-10 px-4 text-xs font-bold whitespace-nowrap bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors shadow-sm"
                    >
                      Clear All<span className="hidden md:inline"> (Business)</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-white/95 backdrop-blur-sm shadow-sm z-10">
                    <tr className="text-[10px] uppercase tracking-widest text-slate-400 font-black">
                      <th className="px-6 py-4 text-left w-12">#</th>
                      <th className="px-2 py-4 text-left">URL Ad Library</th>
                      <th className="px-4 py-4 text-left w-28">Max Ads</th>
                      <th className="px-6 py-4 text-center w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, idx) => (
                      <tr key={row.id} className="group hover:bg-indigo-50/30 transition-colors">
                        <td className="px-6 py-4 text-sm font-bold text-slate-300 group-hover:text-indigo-400">{idx + 1}</td>
                        <td className="px-2 py-4">
                          <input
                            type="url"
                            value={row.url}
                            onChange={(e) => updateRow(row.id, e.target.value)}
                            className={`w-full px-3 py-2 text-sm bg-transparent border rounded-lg outline-none transition-all ${
                              row.url && !isLikelyMetaAds(row.url) ? 'border-red-200 bg-red-50 text-red-600' : 'border-transparent focus:border-indigo-300 focus:bg-white'
                            }`}
                            placeholder="https://www.facebook.com/ads/library/..."
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            min={1}
                            max={row.maxAds ?? 100}
                            value={row.maxAds ?? 100}
                            onChange={(e) => updateRowMax(row.id, Number(e.target.value))}
                            className="w-full px-3 py-2 text-sm bg-transparent border border-slate-200 rounded-lg outline-none focus:border-indigo-300 focus:bg-white transition-all"
                          />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button onClick={() => removeRow(row.id)} disabled={rows.length === 1} className="text-slate-300 hover:text-red-500 disabled:opacity-0 transition-colors">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Action Footer */}
            <div className="space-y-3">
              {!canSetupSelected && selectedBusinessId && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  <span>⚠️ You don&apos;t have permission to setup this business. Only the owner or admins can proceed.</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-4">
                <p className="text-xs text-slate-400 font-medium italic">All data will be automatically categorized by selected business.</p>
                <button 
                  onClick={onSend}
                  disabled={!canSetupSelected || sending || !nonEmptyUrls.length}
                  className={`px-10 py-4 rounded-2xl font-bold text-sm shadow-xl transition-all transform ${
                    !canSetupSelected
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:-translate-y-1 active:translate-y-0 shadow-indigo-100'
                  } disabled:hover:-translate-y-0`}
                >
                  {sending ? 'Scraping in progress...' : '🚀 Start Apify Agent'}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status Messages */}
            {(error || successMsg) && (
              <div className={`p-4 rounded-2xl border ${error ? 'bg-red-50 border-red-100 text-red-700' : 'bg-emerald-50 border-emerald-100 text-emerald-700'} shadow-sm animate-in fade-in slide-in-from-top-4`}>
                <div className="flex items-center gap-3">
                  <span className="text-xl">{error ? '⚠️' : '✅'}</span>
                  <p className="text-sm font-bold">{error || successMsg}</p>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {sending && 'Uploading and processing creatives. Please wait...'}
                  {!sending && !error && 'You can monitor progress in the Activity Monitor below.'}
                </div>
              </div>
            )}

            {/* Stop Import Button (always visible during import) */}
            {importTaskId && (
              <div className="mb-4 flex justify-end">
                <button
                  onClick={stopImport}
                  className={`px-6 py-3 rounded-2xl font-extrabold text-lg bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-2xl border-2 border-red-700 animate-pulse transition-all duration-200 hover:from-red-700 hover:to-pink-700 focus:ring-4 focus:ring-red-300 ${importStopped ? 'opacity-60 cursor-not-allowed' : ''}`}
                  disabled={importStopped}
                >
                  ⏹️ Stop import 
                </button>
              </div>
            )}
            {/* Terminal Logs */}
            <section className="bg-[#0f172a] rounded-2xl shadow-2xl overflow-hidden border border-slate-800">
              <div className="px-4 py-3 bg-[#1e293b] border-b border-slate-800 flex items-center justify-between">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50"></div>
                </div>
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">Activity Monitor</span>
                {importStopped && (
                  <span className="ml-4 px-3 py-1.5 rounded-lg bg-slate-400 text-white text-xs font-bold">Stopped</span>
                )}
              </div>
              <div className="p-5 h-[400px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic">Waiting for actions...<br/>All important steps and errors will be shown here in real time.</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="mb-2 flex gap-3 animate-in fade-in slide-in-from-left-2">
                      <span className="text-slate-500 shrink-0">{new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                      <span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-indigo-400'}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Info Box */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">ℹ️ Access & Permissions</h3>
              <ul className="text-xs text-slate-500 space-y-3 mb-4">
                <li className="flex gap-2"><span>👤</span> <span><strong>Owner:</strong> Can setup only their own businesses</span></li>
                <li className="flex gap-2"><span>👑</span> <span><strong>Admin:</strong> Can setup all businesses (owned + access)</span></li>
                <li className="flex gap-2"><span>👁️</span> <span><strong>User:</strong> View only</span></li>
              </ul>
              {isAdmin && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 mb-3">
                  ✓ You are an admin with full setup access to all businesses
                </div>
              )}
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2 mt-4">🔗 How to Use</h3>
              <ul className="text-xs text-slate-500 space-y-3">
                <li className="flex gap-2"><span>•</span> <span>Paste URLs directly from the Facebook Ads Library search results.</span></li>
                <li className="flex gap-2"><span>•</span> <span>Admins can bypass JSON limits using the Upload button in the gallery.</span></li>
                <li className="flex gap-2"><span>•</span> <span>Check the monitor to see real-time DB sync status.</span></li>
              </ul>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}