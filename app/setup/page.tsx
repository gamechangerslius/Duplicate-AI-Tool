"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
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
  const [rows, setRows] = useState<LinkRow[]>([{ id: uid(), url: '', maxAds: 50 }]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const [businessesLoading, setBusinessesLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; type: 'success' | 'error' | 'info'; message: string; timestamp: Date }>>([]);

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
        }
      }
      setBusinessesLoading(false);
    };
    initUser();
  }, [supabase]);

  const nonEmptyUrls = useMemo(() => rows.map(r => r.url.trim()).filter(Boolean), [rows]);

  const isLikelyMetaAds = useCallback((u: string) => {
    try {
      const host = new URL(u).hostname.toLowerCase();
      return host.includes('facebook') || host.includes('meta') || host.includes('ads');
    } catch { return false; }
  }, []);

  const addRow = () => setRows(rs => [...rs, { id: uid(), url: '', maxAds: 50 }]);
  const removeRow = (id: string) => setRows(rs => (rs.length > 1 ? rs.filter(x => x.id !== id) : rs));
  const updateRow = (id: string, url: string) => setRows(rs => rs.map(x => (x.id === id ? { ...x, url } : x)));
  const updateRowMax = (id: string, maxAds: number) => setRows(rs => rs.map(x => (x.id === id ? { ...x, maxAds } : x)));

  const addLog = (type: 'success' | 'error' | 'info', message: string) => {
    setLogs(prev => [{ id: uid(), type, message, timestamp: new Date() }, ...prev].slice(0, 20));
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

  const onSend = async () => {
    setError(null); setSuccessMsg(null);
    if (!nonEmptyUrls.length || !selectedBusinessId) return;
    setSending(true);
    addLog('info', `🚀 Starting scrape for ${nonEmptyUrls.length} links...`);
    
    try {
      const linksPayload = rows
        .map(r => ({ url: r.url.trim(), maxAds: Number.isFinite(r.maxAds) ? Number(r.maxAds) : 50 }))
        .filter(r => r.url);

      const res = await fetch('/api/forward-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: linksPayload, businessId: selectedBusinessId })
      });
      if (!res.ok) throw new Error('Request failed');
      addLog('success', '✅ Data sent to Apify successfully');
      setSuccessMsg('Task started!');
    } catch (e: any) {
      addLog('error', `❌ Error: ${e.message}`);
      setError(e.message);
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
                    {businesses.map(b => <option key={b.id} value={b.id}>{b.name || b.slug}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {/* Card 2: Links Management */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h2 className="text-lg font-bold flex items-center gap-2">🔗 Source Links</h2>
                <div className="flex gap-2">
                  <button onClick={handlePasteBulk} className="px-4 py-2 text-xs font-bold bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
                    Paste Clipboard
                  </button>
                  <button onClick={addRow} className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                    + Add New
                  </button>
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
                            max={100}
                            value={row.maxAds}
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
            <div className="flex items-center justify-between pt-4">
               <p className="text-xs text-slate-400 font-medium italic">All data will be automatically categorized by selected business.</p>
               <button 
                onClick={onSend}
                disabled={sending || !nonEmptyUrls.length}
                className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:bg-slate-300 disabled:shadow-none transition-all transform hover:-translate-y-1 active:translate-y-0"
               >
                 {sending ? 'Scraping in progress...' : '🚀 Start Apify Agent'}
               </button>
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
              </div>
              <div className="p-5 h-[400px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic">Listening for system events...</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="mb-2 flex gap-3 animate-in fade-in slide-in-from-left-2">
                      <span className="text-slate-500 shrink-0">{log.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
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
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">ℹ️ Usage Tips</h3>
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