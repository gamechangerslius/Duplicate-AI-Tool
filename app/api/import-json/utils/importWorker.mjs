// scripts/importWorker.mjs
// Node.js worker for import tasks (run with: node scripts/importWorker.mjs)
import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
// Inline cancel token helpers to avoid module resolution issues in serverless workers
const CANCEL_DIR = process.env.CANCEL_DIR || (process.env.VERCEL === '1' ? '/tmp/cancel_tokens' : path.join(process.cwd(), 'tmp_cancel_tokens'));
function isCancelledFile(taskId) { try { return fs.existsSync(path.join(CANCEL_DIR, taskId)); } catch { return false; } }
function clearCancelFile(taskId) { try { const f = path.join(CANCEL_DIR, taskId); if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
// Remove dependency on '@supabase/supabase-js' to avoid bundling issues in Vercel workers.
// Implement minimal REST helpers for Supabase DB and Storage.

function sendLog(taskId, message) {
  if (parentPort) parentPort.postMessage({ type: 'log', taskId, message });
}

function makeAdminClient() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error('Missing Supabase admin config in worker');

  const headersJson = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  async function selectSingle(table, columns, eq) {
    const params = new URLSearchParams();
    params.set('select', columns);
    for (const [k, v] of Object.entries(eq || {})) params.set(`${k}`, `eq.${v}`);
    params.set('limit', '1');
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`;
    const res = await fetch(url, { headers: headersJson });
    if (!res.ok) return { data: null, error: new Error(await res.text()) };
    const arr = await res.json();
    return { data: Array.isArray(arr) && arr.length ? arr[0] : null, error: null };
  }

  async function selectMaybeSingle(table, columns, eq) {
    return selectSingle(table, columns, eq);
  }

  async function update(table, data, eq) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(eq || {})) params.set(`${k}`, `eq.${v}`);
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`;
    const res = await fetch(url, { method: 'PATCH', headers: headersJson, body: JSON.stringify(data) });
    if (!res.ok) return { error: new Error(await res.text()) };
    return { error: null };
  }

  async function upsert(table, rows) {
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
    const res = await fetch(url, { method: 'POST', headers: { ...headersJson, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows) });
    if (!res.ok) return { error: new Error(await res.text()) };
    return { error: null };
  }

  async function storageUpload(bucket, destPath, buffer, contentType) {
    const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${destPath}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' },
      body: buffer
    });
    if (!res.ok) throw new Error(await res.text());
    return { path: destPath };
  }

  return {
    selectSingle,
    selectMaybeSingle,
    update,
    upsert,
    storage: { from: (bucket) => ({ upload: (p, b, opts) => storageUpload(bucket, p, b, opts?.contentType) }) }
  };
}

async function uploadBufferToStorage(adminClient, bucket, destPath, buffer, contentType) {
  try {
    const { error } = await adminClient.storage.from(bucket).upload(destPath, buffer, { upsert: true, contentType });
    if (error) throw error;
    return destPath;
  } catch (e) {
    throw e;
  }
}

async function downloadToUint8Array(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} status=${res.status}`);
  const buf = await res.arrayBuffer();
  return { uint8: new Uint8Array(buf), contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

async function runImport(task) {
  const { taskId, items, businessId, maxAds } = task;
  const adminClient = makeAdminClient();

  sendLog(taskId, `[worker] [START] Import started. Items: ${items.length}`);

  // Get business slug
  let businessSlug = businessId;
  try {
    const { data: bdata, error: berr } = await adminClient.selectSingle('businesses', 'slug', { id: businessId });
    if (!berr && bdata?.slug) businessSlug = bdata.slug;
  } catch (e) {}

  const summary = { saved: 0, updated: 0, skipped: 0, errors: 0, errorDetails: [] };

  for (let i = 0; i < items.length; i++) {
    if (isCancelledFile(taskId)) {
      sendLog(taskId, `[worker] [CANCEL] Cancelled at item ${i + 1}`);
      clearCancelFile(taskId);
      break;
    }

    const item = items[i];
    const idx = i + 1;
    sendLog(taskId, `[worker] [ITEM ${idx}/${items.length}] processing ad_archive_id=${item?.ad_archive_id}`);

    try {
      const adArchiveId = item?.ad_archive_id;
      if (!adArchiveId) {
        summary.errors++; summary.errorDetails.push({ reason: 'missing_ad_archive_id', itemIndex: idx });
        sendLog(taskId, `[worker] [ERROR] missing ad_archive_id at index ${idx}`);
        continue;
      }

      // Check existing
      const { data: existing, error: exErr } = await adminClient.selectMaybeSingle('ads', `ad_archive_id, storage_path, video_storage_path, cta_text, cta_type, publisher_platform, text, caption, link_url, page_categories, total_active_time, url, ad_library_url, title, cards_json, cards_count, competitor_niche, creative_json_full`, { ad_archive_id: adArchiveId });
      if (exErr) {
        sendLog(taskId, `[worker] [WARN] checking existing failed: ${exErr.message}`);
      }

      if (existing && (existing.storage_path || existing.video_storage_path)) {
        summary.skipped++;
        sendLog(taskId, `[worker] [SKIP] already exists with media: ${adArchiveId}`);
        continue;
      }

      // Determine media
      const snapshot = item.snapshot || {};
      const isVideo = snapshot.videos && Array.isArray(snapshot.videos) && snapshot.videos.length > 0;
      let storagePath = null;
      let videoStoragePath = null;

      if (isVideo) {
        const video = snapshot.videos[0] || {};
        const videoUrl = video.video_hd_url || video.video_sd_url || video.url;
        const previewUrl = video.video_preview_image_url;

        if (videoUrl) {
          try {
            const { uint8, contentType } = await downloadToUint8Array(videoUrl);
            const ext = contentType.includes('mp4') ? 'mp4' : 'mp4';
            const pathKey = `${businessSlug}/${adArchiveId}.${ext}`;
            await uploadBufferToStorage(adminClient, 'creatives', pathKey, uint8, contentType);
            videoStoragePath = pathKey;
            sendLog(taskId, `[worker] uploaded video for ${adArchiveId} -> ${pathKey}`);
          } catch (e) {
            sendLog(taskId, `[worker] [ERROR] video download/upload failed for ${adArchiveId}: ${e.message}`);
          }
        }

        if (previewUrl) {
          try {
            const { uint8, contentType } = await downloadToUint8Array(previewUrl);
            const ext = contentType.includes('png') ? 'png' : 'jpg';
            const pathKey = `${businessSlug}/${adArchiveId}_preview.${ext}`;
            await uploadBufferToStorage(adminClient, 'creatives', pathKey, uint8, contentType);
            storagePath = pathKey;
            sendLog(taskId, `[worker] uploaded preview for ${adArchiveId} -> ${pathKey}`);
          } catch (e) {
            sendLog(taskId, `[worker] [ERROR] preview download/upload failed for ${adArchiveId}: ${e.message}`);
          }
        }
      } else {
        const imageUrl = snapshot.images?.[0]?.url || snapshot.cards?.[0]?.url || null;
        if (imageUrl) {
          try {
            const { uint8, contentType } = await downloadToUint8Array(imageUrl);
            const ext = contentType.includes('png') ? 'png' : 'jpg';
            const pathKey = `${businessSlug}/${adArchiveId}.${ext}`;
            await uploadBufferToStorage(adminClient, 'creatives', pathKey, uint8, contentType);
            storagePath = pathKey;
            sendLog(taskId, `[worker] uploaded image for ${adArchiveId} -> ${pathKey}`);
          } catch (e) {
            sendLog(taskId, `[worker] [ERROR] image download/upload failed for ${adArchiveId}: ${e.message}`);
          }
        }
      }

      if (!storagePath && !videoStoragePath) {
        summary.errors++; summary.errorDetails.push({ ad_archive_id: adArchiveId, reason: 'no_media_uploaded' });
        sendLog(taskId, `[worker] [ERROR] no media uploaded for ${adArchiveId}`);
        continue;
      }

      // Extract formatted dates if present and convert to ISO
      function toISODate(v) {
        if (!v) return null;
        // If already a Date
        if (v instanceof Date) {
          const t = v.getTime();
          return Number.isFinite(t) ? new Date(t).toISOString() : null;
        }
        // If numeric timestamp
        if (typeof v === 'number' && Number.isFinite(v)) {
          return new Date(v).toISOString();
        }
        // Try parse string
        try {
          const d = new Date(String(v));
          if (!isNaN(d.getTime())) return d.toISOString();
        } catch {}
        return null;
      }

      const start_raw = item.start_date_formatted || item.start_date || snapshot.start_date || null;
      const end_raw = item.end_date_formatted || item.end_date || snapshot.end_date || null;
      const start_date_formatted = toISODate(start_raw);
      const end_date_formatted = toISODate(end_raw);

      // Derive page_name (required not-null column) from item/snapshot or URL
      function derivePageName(item, snapshot) {
        const candidates = [
          item?.page_name,
          item?.advertiser_name,
          item?.advertiser,
          snapshot?.page_name,
          snapshot?.advertiser_name,
          snapshot?.page?.name,
          item?.page?.name,
          item?.ad?.advertiser_name,
        ];
        for (const c of candidates) {
          if (c && typeof c === 'string' && c.trim()) return c.trim();
        }
        // try extract host from url
        const urlCandidate = item?.url || snapshot?.url || item?.ad_url || null;
        if (urlCandidate) {
          try {
            const u = new URL(String(urlCandidate));
            if (u.hostname) return u.hostname.replace(/^www\./, '');
          } catch {}
        }
        return 'unknown';
      }

      const page_name = derivePageName(item, snapshot);

      // Extract additional fields to populate the ads table
      const cta_text = item.cta_text || (snapshot.cta && snapshot.cta.text) || item.cta?.text || item.call_to_action?.text || null;
      const cta_type = item.cta_type || (snapshot.cta && snapshot.cta.type) || item.cta?.type || null;
      const publisher_platform = item.publisher_platform || item.platform || snapshot.platform || null;
      const textField = item.text || item.body || snapshot.text || item.description || null;
      const caption = item.caption || snapshot.caption || item.caption_text || null;
      const link_url = item.link_url || item.link || item.url || snapshot.url || null;
      let page_categories = null;
      if (item.page_categories) {
        page_categories = Array.isArray(item.page_categories) ? item.page_categories.join(', ') : String(item.page_categories);
      } else if (snapshot.page_categories) {
        page_categories = Array.isArray(snapshot.page_categories) ? snapshot.page_categories.join(', ') : String(snapshot.page_categories);
      }
      const total_active_time = item.total_active_time || item.total_active || null;
      const urlField = item.url || snapshot.url || null;
      const ad_library_url = item.ad_library_url || item.ad_library_link || null;
      const title = item.title || item.headline || snapshot.title || null;
      const cards = snapshot.cards || item.cards || null;
      const cards_json = cards || null;
      const cards_count = Array.isArray(cards) ? cards.length : (item.cards_count || null);
      const competitor_niche = item.competitor_niche || item.niche || null;

      const adData = {
        business_id: businessId,
        ad_archive_id: adArchiveId,
        display_format: isVideo ? 'VIDEO' : 'IMAGE',
        storage_path: storagePath,
        video_storage_path: videoStoragePath,
        creative_json_full: item,
        start_date_formatted: start_date_formatted,
        end_date_formatted: end_date_formatted,
        page_name: page_name,
        created_at: new Date().toISOString(),
        // additional fields
        cta_text,
        cta_type,
        publisher_platform,
        text: textField,
        caption,
        link_url,
        page_categories,
        total_active_time,
        url: urlField,
        ad_library_url,
        title,
        cards_json,
        cards_count,
        competitor_niche
      };

      if (existing) {
        // If any of the important fields in the existing row are null/empty,
        // perform a full update with all extracted fields. Otherwise only
        // patch missing storage paths (to avoid overwriting valid data).
        const ensureFields = ['cta_text','cta_type','publisher_platform','text','caption','link_url','page_categories','total_active_time','url','ad_library_url','title','cards_json','cards_count','competitor_niche','creative_json_full'];
        let anyMissing = false;
        for (const f of ensureFields) {
          const v = existing[f];
          if (v === null || v === undefined || v === '') { anyMissing = true; break; }
        }

        if (anyMissing) {
          // Full update: overwrite fields for this ad_archive_id
          const { error: upErr } = await adminClient.update('ads', adData, { ad_archive_id: adArchiveId });
          if (upErr) {
            summary.errors++; summary.errorDetails.push({ ad_archive_id: adArchiveId, reason: 'db_update_failed', message: upErr.message });
            sendLog(taskId, `[worker] [ERROR] DB full-update failed for ${adArchiveId}: ${upErr.message}`);
          } else {
            summary.updated++; sendLog(taskId, `[worker] [UPDATE_FULL] ${adArchiveId}`);
          }
        } else {
          // Only ensure storage paths if missing
          const patch = {};
          if ((!existing.storage_path || existing.storage_path === '') && storagePath) patch.storage_path = storagePath;
          if ((!existing.video_storage_path || existing.video_storage_path === '') && videoStoragePath) patch.video_storage_path = videoStoragePath;

          if (Object.keys(patch).length > 0) {
            const { error: upErr } = await adminClient.update('ads', patch, { ad_archive_id: adArchiveId });
            if (upErr) {
              summary.errors++; summary.errorDetails.push({ ad_archive_id: adArchiveId, reason: 'db_update_failed', message: upErr.message });
              sendLog(taskId, `[worker] [ERROR] DB update failed for ${adArchiveId}: ${upErr.message}`);
            } else {
              summary.updated++; sendLog(taskId, `[worker] [UPDATE] ${adArchiveId} (patched ${Object.keys(patch).length} fields)`);
            }
          } else {
            summary.skipped++; sendLog(taskId, `[worker] [SKIP] ${adArchiveId} (no missing fields)`);
          }
        }
      } else {
        // Use upsert to avoid duplicate key errors in concurrent runs
        try {
          const { error: upsertErr } = await adminClient.upsert('ads', [adData]);
          if (upsertErr) {
            // If upsert fails for other reasons, log it
            summary.errors++; summary.errorDetails.push({ ad_archive_id: adArchiveId, reason: 'db_upsert_failed', message: upsertErr.message });
            sendLog(taskId, `[worker] [ERROR] DB upsert failed for ${adArchiveId}: ${upsertErr.message}`);
          } else {
            summary.saved++; sendLog(taskId, `[worker] [UPSERTED] ${adArchiveId}`);
          }
        } catch (e) {
          summary.errors++; summary.errorDetails.push({ ad_archive_id: adArchiveId, reason: 'db_upsert_exception', message: e?.message });
          sendLog(taskId, `[worker] [ERROR] DB upsert exception for ${adArchiveId}: ${e?.message}`);
        }
      }

    } catch (err) {
      summary.errors++; summary.errorDetails.push({ itemIndex: idx, message: err?.message });
      sendLog(taskId, `[worker] [EXCEPTION] item ${idx}: ${err?.message}`);
    }
  }

  sendLog(taskId, `[worker] [COMPLETE] saved=${summary.saved} updated=${summary.updated} skipped=${summary.skipped} errors=${summary.errors}`);
  if (parentPort) parentPort.postMessage({ type: 'done', taskId, summary });
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    if (msg && msg.type === 'import') {
      await runImport(msg.task);
    }
  });
  if (workerData) runImport(workerData);
}
