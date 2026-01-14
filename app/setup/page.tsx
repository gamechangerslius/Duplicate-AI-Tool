"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { isUserAdmin, getUserBusinesses } from '@/utils/supabase/admin';

type LinkRow = { id: string; url: string };
type Business = { id: string; slug: string; name?: string; owner_id?: string };

const uid = () => Math.random().toString(36).slice(2, 10);

export default function SetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<LinkRow[]>([{ id: uid(), url: '' }]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const [businessesLoading, setBusinessesLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [maxAds, setMaxAds] = useState<number>(50); // Default max ads
  const [logs, setLogs] = useState<Array<{ id: string; type: 'success' | 'error' | 'info'; message: string; timestamp: Date }>>([]); // Logs for UI display

  useEffect(() => {
    const initUser = async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id ?? null;
      setUserId(userId);

      if (userId) {
        // Check if user is admin
        const adminStatus = await isUserAdmin(userId);
        setIsAdmin(adminStatus);
        
        // Load businesses (all if admin, only owned if regular user)
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

  const addLog = (type: 'success' | 'error' | 'info', message: string) => {
    const logEntry = { id: uid(), type, message, timestamp: new Date() };
    setLogs(prev => [logEntry, ...prev].slice(0, 20)); // Keep last 20 logs
  };

  const handlePasteBulk = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const candidates = text.split(/\r?\n|\s+/).map(t => t.trim()).filter(Boolean);
      if (!candidates.length) return;
      const merged = Array.from(new Set([...nonEmptyUrls, ...candidates]));
      setRows(merged.map(u => ({ id: uid(), url: u })));
      addLog('success', `✅ ${candidates.length} links pasted from clipboard`);
      setSuccessMsg('Links pasted from clipboard');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      addLog('error', '❌ Failed to read clipboard');
      setError('Failed to read clipboard');
      setTimeout(() => setError(null), 3000);
    }
  };

  const onSend = async () => {
    setError(null); setSuccessMsg(null);
    if (!nonEmptyUrls.length) { setError('Add at least one link'); return; }
    if (!selectedBusinessId) { setError('Please select a business'); return; }
    setSending(true);
    addLog('info', `� Preparing ${nonEmptyUrls.length} links...`);
    addLog('info', `📤 Sending request to Apify (max ${maxAds} ads per link)...`);
    
    try {
      console.log('📤 Sending to Apify:', { businessId: selectedBusinessId, linksCount: nonEmptyUrls.length, maxAds });
      console.log('🔗 Links:', nonEmptyUrls);
      
      const res = await fetch('/api/forward-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          links: nonEmptyUrls,
          businessId: selectedBusinessId,
          maxAds
        })
      });
      
      addLog('info', '⏳ Apify is scraping ads... (downloading images, saving to DB)');
      
      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const msg = ct.includes('application/json') ? (await res.json()).message : await res.text();
        throw new Error(msg || 'Apify error');
      }
      const data = ct.includes('application/json') ? await res.json() : await res.text();
      
      console.log('✅ Apify Results:', data);
      console.log('📊 Complete Response:', JSON.stringify(data, null, 2));
      
      // Log detailed results
      addLog('success', `✅ Scraping complete!`);
      addLog('info', `💾 Saved ${data.saved || 0} ads, ${data.errors || 0} errors`);
      
      // Show error details if any
      if (data.errorDetails && data.errorDetails.length > 0) {
        const imageErrors = data.errorDetails.filter((e: any) => e.reason?.includes('image'));
        const dbErrors = data.errorDetails.filter((e: any) => e.reason === 'db_save_failed');
        
        if (imageErrors.length > 0) {
          addLog('error', `❌ Image errors: ${imageErrors.length} ads (${imageErrors.map((e: any) => e.reason).join(', ')})`);
        }
        if (dbErrors.length > 0) {
          addLog('error', `❌ DB errors: ${dbErrors.length} ads`);
        }
      }
      
      setSuccessMsg('Data saved to database!');
      setRows([{ id: uid(), url: '' }]);
    } catch (e: any) {
      console.error('❌ Error:', e?.message);
      addLog('error', `❌ Error: ${e?.message}`);
      setError(e?.message || 'Unknown error');
    } finally {
      setSending(false);
    }
  };

  const handleJsonUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccessMsg(null);

    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedBusinessId) {
      setError('Please select a business first');
      return;
    }

    setSending(true);
    addLog('info', '📂 Reading JSON file...');
    
    try {
      const fileContent = await file.text();
      addLog('info', '📝 Parsing JSON data...');
      const jsonData = JSON.parse(fileContent);

      // Validate JSON structure
      if (!Array.isArray(jsonData)) {
        throw new Error('JSON must be an array of ad objects from Apify');
      }

      if (jsonData.length === 0) {
        throw new Error('JSON array is empty');
      }

      addLog('success', `✅ Found ${jsonData.length} ads in JSON`);
      addLog('info', '📤 Uploading to server...');

      console.log('📤 Uploading JSON data:', { businessId: selectedBusinessId, itemsCount: jsonData.length });
      console.log('📋 First item:', JSON.stringify(jsonData[0], null, 2));

      const res = await fetch('/api/import-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: jsonData,
          businessId: selectedBusinessId,
          maxAds
        })
      });

      addLog('info', '⏳ Processing ads (downloading images, saving to DB)...');

      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const msg = ct.includes('application/json') ? (await res.json()).message : await res.text();
        throw new Error(msg || 'Import failed');
      }

      const data = ct.includes('application/json') ? await res.json() : await res.text();
      
      console.log('✅ Import Results:', data);
      
      // Log detailed results
      addLog('success', `✅ Import complete!`);
      addLog('info', `💾 Saved ${data.saved || 0} ads, ${data.errors || 0} errors`);
      
      // Show error details if any
      if (data.errorDetails && data.errorDetails.length > 0) {
        const imageErrors = data.errorDetails.filter((e: any) => e.reason?.includes('image'));
        const dbErrors = data.errorDetails.filter((e: any) => e.reason === 'db_save_failed');
        
        if (imageErrors.length > 0) {
          addLog('error', `❌ Image errors: ${imageErrors.length} ads (${imageErrors.map((e: any) => e.reason).join(', ')})`);
        }
        if (dbErrors.length > 0) {
          addLog('error', `❌ DB errors: ${dbErrors.length} ads`);
        }
      }
      
      setSuccessMsg(`Successfully imported ${data.saved || 0} ads!`);

      // Reset file input
      event.target.value = '';
    } catch (e: any) {
      console.error('❌ JSON Upload Error:', e?.message);
      addLog('error', `❌ Import failed: ${e?.message}`);
      setError(e?.message || 'Failed to import JSON');
      event.target.value = '';
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
          <h2 className="text-2xl font-medium text-slate-900 mb-2">Send Links to Apify</h2>
          <p className="text-slate-600">Paste Facebook/Meta Ads Library links to extract ad data via Apify.</p>
        </div>

        {/* Business Selection */}
        {businessesLoading ? (
          <div className="mb-6 p-3 bg-slate-50 border border-slate-200 rounded text-slate-600 text-sm">
            Loading businesses...
          </div>
        ) : businesses.length === 0 ? (
          <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded text-amber-700 text-sm">
            ⚠️ You don&apos;t own any businesses. Contact an administrator to set up access.
          </div>
        ) : (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-900 mb-2">
              Select Business
              {isAdmin && ' (Admin: all businesses visible)'}
            </label>
            {businesses.length === 1 ? (
              <div className="px-3 py-2 border border-slate-300 rounded bg-slate-50 text-slate-700 text-sm">
                {businesses[0].name || businesses[0].slug}
              </div>
            ) : (
              <select
                value={selectedBusinessId || ''}
                onChange={(e) => setSelectedBusinessId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-black focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none"
              >
                <option value="">Choose a business...</option>
                {businesses.map((biz) => (
                  <option key={biz.id} value={biz.id}>
                    {biz.name || biz.slug}
                    {isAdmin && biz.owner_id !== userId ? ' (owned by other)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

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
        <div className="flex gap-3 mb-6 flex-wrap items-center">
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

          {/* JSON Upload */}
          <label className="px-4 py-2 border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50 transition-colors text-sm font-medium cursor-pointer">
            📁 Upload JSON
            <input
              type="file"
              accept=".json"
              onChange={handleJsonUpload}
              disabled={sending}
              className="hidden"
            />
          </label>

          {/* Max Ads Input */}
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-sm font-medium text-slate-700">Max ads:</label>
            <input
              type="number"
              min="1"
              value={maxAds}
              onChange={(e) => setMaxAds(parseInt(e.target.value, 10) || 50)}
              className="w-20 px-3 py-2 border border-slate-300 rounded text-sm text-black focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none"
            />
          </div>
        </div>

        {/* Logs Section - Always visible when loading or has logs */}
        {(logs.length > 0 || sending) && (
          <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-slate-900">Activity Log</h3>
                {sending && (
                  <div className="flex items-center gap-1.5">
                    <div className="animate-spin h-3 w-3 border-2 border-slate-600 border-t-transparent rounded-full"></div>
                    <span className="text-xs text-slate-600">Processing...</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => setLogs([])}
                disabled={sending}
                className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50"
              >
                Clear
              </button>
            </div>
            <div className="divide-y divide-slate-200 max-h-48 overflow-y-auto">
              {logs.length === 0 && sending ? (
                <div className="px-4 py-3 text-sm text-slate-500 text-center">
                  Starting...
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="px-4 py-2 text-xs text-slate-700 hover:bg-slate-100 transition-colors">
                    <div className="flex items-start justify-between">
                      <span className="flex-1">{log.message}</span>
                      <span className="text-slate-500 ml-2 whitespace-nowrap">
                        {log.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRow(row.id, e.target.value)}
                      placeholder="https://www.facebook.com/ads/library/?id=..."
                      className={`w-full px-3 py-2 border rounded text-sm transition-colors text-black ${
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
            disabled={sending || nonEmptyUrls.length === 0 || !selectedBusinessId || businessesLoading}
            className="px-6 py-2.5 bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {sending ? 'Processing with Apify...' : 'Send to Apify'}
          </button>
          <p className="text-xs text-slate-500">
            Powered by <code className="bg-slate-100 px-1.5 py-0.5 rounded">Apify</code>
          </p>
        </div>

        {/* Info Note */}
        <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <h3 className="text-sm font-medium text-slate-900 mb-2">How it works</h3>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>1. Add or paste links from Facebook Ads Library</li>
            <li>2. Select your business to associate with the data</li>
            <li>3. Request is sent to Apify actor for processing</li>
            <li>4. Results are polled and returned when ready</li>
            <li>5. JSON file downloads automatically</li>
            <li>6. Check browser console (F12) for detailed logs</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
