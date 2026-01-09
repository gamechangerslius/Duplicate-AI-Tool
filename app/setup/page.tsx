"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

type LinkRow = { id: string; url: string };
const uid = () => Math.random().toString(36).slice(2, 10);

export default function SetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<LinkRow[]>([{ id: uid(), url: '' }]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [supabase]);

  const nonEmptyUrls = useMemo(
    () => Array.from(new Set(rows.map(r => r.url.trim()).filter(Boolean))),
    [rows]
  );

  const isLikelyMetaAds = useCallback((u: string) => {
    try {
      const { hostname } = new URL(u);
      const host = hostname.toLowerCase();
      return host.includes('facebook') || host.includes('meta') || host.includes('ads');
    } catch {
      return false;
    }
  }, []);

  const invalidUrls = useMemo(
    () => nonEmptyUrls.filter(u => !isLikelyMetaAds(u)),
    [nonEmptyUrls, isLikelyMetaAds]
  );

  const addRow = () => setRows(rs => [...rs, { id: uid(), url: '' }]);
  const removeRow = (id: string) => setRows(rs => (rs.length > 1 ? rs.filter(x => x.id !== id) : rs));
  const updateRow = (id: string, url: string) => setRows(rs => rs.map(x => (x.id === id ? { ...x, url } : x)));

  const handlePasteBulk = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const candidates = text.split(/\r?\n|\s+/).map(t => t.trim()).filter(Boolean);
      if (!candidates.length) return;
      const merged = Array.from(new Set([...nonEmptyUrls, ...candidates]));
      setRows(merged.map(u => ({ id: uid(), url: u })));
      setSuccessMsg('Links pasted from clipboard');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setError('Failed to read clipboard');
      setTimeout(() => setError(null), 3000);
    }
  };

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const onSend = async () => {
    setError(null); setSuccessMsg(null);
    if (!nonEmptyUrls.length) { setError('Add at least one link'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/forward-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: nonEmptyUrls })
      });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const msg = ct.includes('application/json') ? (await res.json()).message : await res.text();
        throw new Error(msg || 'Webhook error');
      }
      const data = ct.includes('application/json') ? await res.json() : await res.text();
      const filename = `facebook_meta_ads_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      downloadJson(data, filename);
      setSuccessMsg('JSON downloaded successfully');
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Simple Header */}
      <header className="border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <button 
            onClick={() => router.push('/')} 
            className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            ← Back to Gallery
          </button>
          <h1 className="text-lg font-medium text-slate-900">Setup</h1>
          <div className="text-sm text-slate-500">{nonEmptyUrls.length} links</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        
        {/* Title Section */}
        <div className="mb-6">
          <h2 className="text-2xl font-medium text-slate-900 mb-2">Send Links to Webhook</h2>
          <p className="text-slate-600">Paste Facebook/Meta Ads Library links and send them to your webhook.</p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-green-400 hover:text-green-600">×</button>
          </div>
        )}
        {invalidUrls.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-700 text-sm">
            ⚠️ Warning: {invalidUrls.length} links don&apos;t appear to be from Facebook/Meta Ads
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={addRow}
            disabled={sending}
            className="px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            + Add Row
          </button>
          <button
            onClick={handlePasteBulk}
            disabled={sending}
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Paste from Clipboard
          </button>
        </div>

        {/* Links Table */}
        <div className="border border-slate-200 rounded-lg overflow-hidden mb-6">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase tracking-wide w-12">#</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase tracking-wide">Link</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-slate-600 uppercase tracking-wide w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row, idx) => (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-500">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <input
                      type="url"
                      value={row.url}
                      onChange={(e) => updateRow(row.id, e.target.value)}
                      placeholder="https://www.facebook.com/ads/library/?id=..."
                      className={`w-full px-3 py-2 border rounded text-sm transition-colors ${
                        row.url && !isLikelyMetaAds(row.url)
                          ? 'border-red-300 focus:border-red-400 focus:ring-1 focus:ring-red-400'
                          : 'border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-400'
                      } outline-none`}
                    />
                    {row.url && !isLikelyMetaAds(row.url) && (
                      <p className="text-xs text-red-600 mt-1">Not a Facebook/Meta Ads link</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1 || sending}
                      className="text-sm text-red-600 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Send Button */}
        <div className="flex items-center justify-between">
          <button
            onClick={onSend}
            disabled={sending || nonEmptyUrls.length === 0}
            className="px-6 py-2.5 bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {sending ? 'Sending...' : 'Send to Webhook'}
          </button>
          <p className="text-xs text-slate-500">
            Webhook configured via <code className="bg-slate-100 px-1.5 py-0.5 rounded">WEBHOOK_URL</code>
          </p>
        </div>

        {/* Info Note */}
        <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <h3 className="text-sm font-medium text-slate-900 mb-2">How it works</h3>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>1. Add or paste links from Facebook Ads Library</li>
            <li>2. Your client_id is automatically included with the request</li>
            <li>3. Webhook processes data and returns a JSON file</li>
            <li>4. File downloads automatically to your browser</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
