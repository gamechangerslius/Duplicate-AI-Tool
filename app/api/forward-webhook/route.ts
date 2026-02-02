import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isUserAdmin } from "@/utils/supabase/admin";
import { pushLog } from "@/utils/sse-logs";

export const runtime = "nodejs";

// Encode actor id path preserving slashes (e.g. "user/actor" -> "user/actor" with segments encoded)
function encodeActorPath(actorId: string) {
  if (!actorId || typeof actorId !== 'string') return '';
  return actorId.split('/').map(encodeURIComponent).join('/');
}

// ----------------------
// Helper: Sleep for ms
// ----------------------
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// ----------------------
// Helper: safe JSON stringify
// ----------------------
function safeJsonStringify(v: any) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ----------------------
// Normalize and validate URLs
// ----------------------
type NormalizedLink = { url: string; maxAds?: number };

function normalizeAndValidateUrls(rawLinks: any[], defaultMax: number | undefined): { links: NormalizedLink[]; rejected: any[] } {
  const rejected: any[] = [];
  const links: NormalizedLink[] = [];

  for (const item of rawLinks) {
    const candidate = item?.url ?? item;
    let s = String(candidate ?? "").trim().replace(/\s+/g, "");

    if (!s) {
      rejected.push({ reason: "empty", item });
      continue;
    }

    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        rejected.push({ reason: "bad-protocol", item, normalized: s });
        continue;
      }

      // Derive maxAds priority: explicit field > query param > default
      const parsedMax = Number(item?.maxAds);
      let maxAdsVal: number | undefined = Number.isFinite(parsedMax) ? parsedMax : undefined;

      if (!Number.isFinite(maxAdsVal as number)) {
        // Read possible query params from the URL
        const qp = u.searchParams;
        const candKeys = ["maxAds", "max_ads", "limit", "count", "max", "maxCreatives"]; 
        for (const k of candKeys) {
          const v = qp.get(k);
          if (v != null) {
            const n = Number(v);
            if (Number.isFinite(n)) { maxAdsVal = n; break; }
          }
        }
      }

      if (!Number.isFinite(maxAdsVal as number)) maxAdsVal = defaultMax;

      links.push({ url: u.toString(), maxAds: maxAdsVal });
    } catch {
      rejected.push({ reason: "invalid-url", item, normalized: s });
    }
  }

  // Ensure unique URLs
  const seen = new Set<string>();
  const unique: NormalizedLink[] = [];
  for (const entry of links) {
    if (!seen.has(entry.url)) {
      seen.add(entry.url);
      unique.push(entry);
    }
  }

  return { links: unique, rejected };
}

// ----------------------
// Create Supabase admin client
// ----------------------
function createAdminClient(reqId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) throw new Error("Supabase admin config missing");

  const { createClient: create } = require("@supabase/supabase-js");
  const client = create(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
  });

  return client;
}

// ----------------------
// Start async Apify run (no polling) and return start response
// ----------------------
async function startAsyncApify(runInput: any, reqId: string, apifyActorId: string, apifyToken: string, clientTaskId: string | null, log?: (m: string) => void) {
  try {
    const startUrl = `https://api.apify.com/v2/acts/${encodeActorPath(apifyActorId)}/runs?token=${encodeURIComponent(apifyToken)}`;
    const msg = `🟡 Starting async Apify run`;
    console.log(`[${reqId}] ${msg}`);
    log?.(msg);

    const startResp = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runInput),
    });

    const startText = await startResp.text();
    let startJson: any = null;
    try { startJson = JSON.parse(startText); } catch { startJson = null; }

    console.log(`[${reqId}] 📝 Apify async start response:`, startJson ?? startText?.slice?.(0,200));
    log?.(`📝 Apify async start response received`);
    return startJson;
  } catch (err: any) {
    console.log(`[${reqId}] 💥 startAsyncApify error:`, err?.message);
    log?.(`💥 startAsyncApify error: ${err?.message}`);
    return null;
  }
}

// ----------------------
// Poll an async Apify run until completion, then fetch dataset items
// ----------------------
async function runApifyAsyncPoll(runInput: any, reqId: string, apifyActorId: string, apifyToken: string, perLinkLimit: number | undefined, totalTimeoutSec: number, log?: (m: string) => void) {
  const start = await startAsyncApify(runInput, reqId, apifyActorId, apifyToken, null, log);
  const runId = start?.data?.id || start?.id || start?.data?.runId || start?.runId;
  if (!runId) {
    console.log(`[${reqId}] ❌ Failed to start async run`);
    log?.(`❌ Failed to start async run`);
    return null;
  }

  const pollUrl = (id: string) => `https://api.apify.com/v2/actor-runs/${encodeURIComponent(id)}?token=${encodeURIComponent(apifyToken)}`;
  const startedAt = Date.now();
  let status = start?.data?.status || start?.status;
  let datasetId = start?.data?.defaultDatasetId || start?.defaultDatasetId;

  // Poll every 3s until finished or timeout
  while (true) {
    if (["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "CANCELLED"].includes(String(status || '').toUpperCase())) break;
    if (Date.now() - startedAt > totalTimeoutSec * 1000) {
      console.log(`[${reqId}] ⏳ Async poll timeout after ${totalTimeoutSec}s`);
      log?.(`⏳ Async poll timeout after ${totalTimeoutSec}s`);
      break;
    }
    await sleep(3000);
    try {
      const r = await fetch(pollUrl(runId));
      const txt = await r.text();
      let js: any = null; try { js = JSON.parse(txt); } catch {}
      status = js?.data?.status || js?.status;
      datasetId = datasetId || js?.data?.defaultDatasetId || js?.defaultDatasetId;
      log?.(`⏱️ Status: ${status || 'unknown'}${datasetId ? ' (dataset ready)' : ''}`);
    } catch (e: any) {
      console.log(`[${reqId}] ⚠️ Poll error: ${e?.message}`);
      log?.(`⚠️ Poll error: ${e?.message}`);
    }
  }

  if (String(status || '').toUpperCase() !== 'SUCCEEDED' || !datasetId) {
    console.log(`[${reqId}] ❌ Async run finished with status=${status} datasetId=${datasetId}`);
    log?.(`❌ Async finished with status=${status}`);
    return null;
  }

  // Fetch dataset items
  const lim = Number.isFinite(perLinkLimit as number) ? Number(perLinkLimit) : undefined;
  const itemsUrl = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(apifyToken)}&clean=true${lim ? `&limit=${encodeURIComponent(String(lim))}` : ''}`;
  try {
    const itemsResp = await fetch(itemsUrl);
    const text = await itemsResp.text();
    let data: any = null; try { data = JSON.parse(text); } catch {}
    if (Array.isArray(data)) {
      log?.(`✅ Retrieved ${data.length} items from dataset`);
      return data;
    }
  } catch (e: any) {
    console.log(`[${reqId}] ⚠️ Fetch dataset items error: ${e?.message}`);
    log?.(`⚠️ Fetch dataset items error: ${e?.message}`);
  }
  return null;
}

// ----------------------
// Run Apify with fallback from sync → async
// ----------------------
async function runApifyWithFallback(runInput: any, reqId: string, apifyActorId: string, apifyToken: string, clientTaskId: string | null, timeoutSec: number, perLinkLimit?: number, log?: (m: string) => void) {
  const syncUrl = `https://api.apify.com/v2/acts/${encodeActorPath(apifyActorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}&timeout=${encodeURIComponent(String(timeoutSec))}`;
  console.log(`[${reqId}] 🚀 Running run-sync-get-dataset-items, timeout=${timeoutSec}s`);
  log?.(`🚀 run-sync-get-dataset-items (timeout=${timeoutSec}s)`);
  // run-sync started for URL
  console.log(`[${reqId}] 🚀 run-sync start for ${runInput.urls?.[0]?.url || 'unknown'}`);
  log?.(`▶️ run-sync start for ${runInput.urls?.[0]?.url || 'unknown'}`);

  try {
    const resp = await fetch(syncUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(runInput) });
    const text = await resp.text();

    let data: any = null;
    try { data = JSON.parse(text); } catch {}

      if (Array.isArray(data) && data.length > 0) {
      console.log(`[${reqId}] ✅ run-sync returned ${data.length} items`);
      log?.(`✅ run-sync returned ${data.length} items`);
      return data;
    }

    // Timeout → fallback to async with polling to wait for results
    if (resp.status === 408 || data?.error?.type === 'run-timeout-exceeded') {
      console.log(`[${reqId}] ⚠️ run-sync timeout, starting async run with polling`);
      log?.(`⚠️ run-sync timeout, switching to async + polling`);
      const polled = await runApifyAsyncPoll(runInput, reqId, apifyActorId, apifyToken, perLinkLimit, Math.max(600, timeoutSec), log);
      return polled;
    }

    console.log(`[${reqId}] ⚠️ run-sync did not return array`);
    return null;

  } catch (err: any) {
    console.log(`[${reqId}] 💥 run-sync exception:`, err?.message);
    log?.(`💥 run-sync exception: ${err?.message}`);
    return null;
  }
}

// ----------------------
// Main POST handler
// ----------------------
export async function POST(req: Request) {
  const reqId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let clientTaskId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const { links, businessId, maxAds: defaultMaxAds, taskId } = body ?? {};
    clientTaskId = typeof taskId === 'string' && taskId ? taskId : null;
    const log = (m: string) => { if (clientTaskId) pushLog(clientTaskId, m); };

    if (!Array.isArray(links) || links.length === 0) {
      return NextResponse.json({ message: "Field 'links' must be a non-empty array" }, { status: 400 });
    }

    const apifyToken = process.env.APIFY_TOKEN;
    const apifyActorId = process.env.APIFY_ACTOR_ID;
    if (!apifyToken || !apifyActorId) return NextResponse.json({ message: "Missing Apify configuration" }, { status: 500 });

    // Dev bypass: set header `x-dev-bypass: 1` or `true` to skip auth (convenient for curl testing)
    const devBypassHeader = (req.headers.get('x-dev-bypass') || '').toLowerCase();
    const devBypass = devBypassHeader === '1' || devBypassHeader === 'true';

    let hasAccess = false;
    if (devBypass) {
      console.log(`[${reqId}] ⚠️ Dev bypass enabled - skipping auth`);
      hasAccess = true;
    } else {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

      const userIsAdmin = await isUserAdmin(user.id);
      hasAccess = userIsAdmin;
      if (!hasAccess) {
        const { data: biz } = await supabase.from("businesses").select("id").eq("id", businessId).eq("owner_id", user.id).single();
        hasAccess = !!biz;
      }
      if (!hasAccess) return NextResponse.json({ message: "You don't have access to this business" }, { status: 403 });
    }

    const { links: normalizedLinks, rejected } = normalizeAndValidateUrls(links, defaultMaxAds);
    log(`🔗 Accepted ${normalizedLinks.length} link(s), rejected ${rejected.length})`);

    if (normalizedLinks.length === 0) {
      return NextResponse.json({
        message: "No valid URLs after normalization",
        debug: { rejectedSample: rejected.slice(0, 5), linksSample: links.slice(0, 5) },
      }, { status: 400 });
    }

    const requestedTimeout = Number(process.env.APIFY_TIMEOUT) || 300;
    // Keep sync timeout reasonable (Apify hard limit ~300s), but allow async polling longer
    const apifyTimeout = Math.min(requestedTimeout, 300);

    const allResults: any[] = [];
    for (const entry of normalizedLinks) {
      const perLinkLimit = Math.min(Math.max(Number(entry.maxAds || defaultMaxAds || 50), 1), 1000);
      log(`➡️ Start link: ${entry.url} (maxAds=${perLinkLimit})`);
      const runInput = {
        urls: [{ url: entry.url }],
        maxAds: perLinkLimit,
        limit: perLinkLimit, // be defensive if actor uses a different key
        viewAllAds: true,
        includeAdsData: true,
      };
      const results: any = await runApifyWithFallback(runInput, reqId, apifyActorId, apifyToken, clientTaskId, apifyTimeout, perLinkLimit, log);

      if (results && Array.isArray(results)) {
        allResults.push(...results);
        log(`📦 Collected ${results.length} item(s) for link`);
        continue;
      }

      // If no results even after polling, continue to next link
      // otherwise continue to next link
    }

    if (!allResults.length) {
      log(`⚠️ No data from Apify`);
      return NextResponse.json({ message: "No data from Apify", items: 0 });
    }

    // Return Apify results directly to caller
    log(`✅ Done. Total items=${allResults.length}`);
    return NextResponse.json({ message: "Apify results", items: allResults, count: allResults.length });

  } catch (e: any) {
    console.log(`[${reqId}] 💥 Exception:`, e?.message);
    if (clientTaskId) pushLog(clientTaskId, `💥 Exception: ${e?.message}`);
    return NextResponse.json({ message: e?.message || "Internal Error", reqId }, { status: 500 });
  }
}
