import { NextResponse } from "next/server";
import { Worker } from "worker_threads";
import path from "path";
import { pathToFileURL } from 'url';
import { pushLog } from "@/utils/sse-logs";
// Force Vercel to include '@supabase/supabase-js' in the Serverless bundle.
// The worker file imports this package, but since the worker is launched as a separate
// module file, it isn't analyzed during bundling. A direct import here ensures the
// dependency is copied to /var/task/node_modules so the worker can resolve it at runtime.
import { createClient as __SUPABASE_FORCE_INCLUDE } from '@supabase/supabase-js';

export const runtime = "nodejs";
// Prevent tree-shaking of the above import
void __SUPABASE_FORCE_INCLUDE;

const runningWorkers = new Map();

export async function POST(req: Request) {
  const workerPath = path.join(
  process.cwd(), 
  "app/api/import-json/utils/importWorker.mjs"
  );
  let body: any = {};
  try {
    const contentType = req.headers.get('content-type') || '';
    let items: any[] = [];
    let businessId: string | undefined;
    let maxAds: any = undefined;
    let taskId: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      // Parse form data and merge JSON files
      const form = await req.formData();
      // Accept form fields: businessId, maxAds, taskId
      if (form.has('businessId')) businessId = String(form.get('businessId'));
      if (form.has('maxAds')) maxAds = form.get('maxAds');
      if (form.has('taskId')) taskId = String(form.get('taskId'));

      for (const [key, value] of form.entries()) {
        // If value is a File/Blob, try to read and parse JSON
        try {
          // @ts-ignore - Blob/ File in Node FormData
          if (value && typeof (value as any).text === 'function') {
            // read text
            // @ts-ignore
            const txt = await (value as any).text();
            if (!txt) continue;
            try {
              const parsed = JSON.parse(txt);
              if (Array.isArray(parsed)) items.push(...parsed);
              else if (Array.isArray(parsed.items)) items.push(...parsed.items);
              else items.push(parsed);
            } catch (e) {
              // ignore non-json files
            }
            continue;
          }
        } catch (e) {
          // ignore
        }
      }
    } else {
      body = await req.json().catch(() => ({}));
      items = Array.isArray(body.items) ? body.items : [];
      businessId = body.businessId;
      maxAds = body.maxAds;
      taskId = body.taskId;
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { message: "Field 'items' must be a non-empty array" },
        { status: 400 }
      );
    }
    if (!taskId) {
      return NextResponse.json(
        { message: "Missing taskId" },
        { status: 400 }
      );
    }
    try {
  const worker = new Worker(workerPath, {
    workerData: { taskId, items, businessId, maxAds },
    type: 'module' // Required for .mjs
  } as any);
  runningWorkers.set(taskId, worker);
    worker.on('message', (msg) => {
      if (msg.type === 'log') pushLog(taskId, msg.message);
      if (msg.type === 'done') runningWorkers.delete(taskId);
    });
    worker.on('error', (err) => {
      pushLog(taskId, `[worker] Error: ${err.message}`);
      runningWorkers.delete(taskId);
    });
    worker.on('exit', (code) => {
      pushLog(taskId, `[worker] Exited with code ${code}`);
      runningWorkers.delete(taskId);
    });
    return NextResponse.json({
      message: `Import started in worker`,
      taskId,
      saved: 0,
      errors: 0,
      errorDetails: [],
    });
  } catch (e: any) {
  pushLog(taskId, `[server] Failed to start worker: ${e.message}`);
}
    // Launch worker for import (ESM)
    
  } catch (err: any) {
    return NextResponse.json(
      { message: err?.message || "Internal server error", saved: 0 },
      { status: 500 }
    );
  }
}

