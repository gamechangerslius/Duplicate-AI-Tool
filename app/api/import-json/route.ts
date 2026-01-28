import { NextResponse } from "next/server";
import { Worker } from "worker_threads";
import path from "path";
import { pathToFileURL } from 'url';
import { pushLog } from "@/utils/sse-logs";

export const runtime = "nodejs";

// ...existing code...

// In-memory map of running workers by taskId
const runningWorkers = new Map();

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
    const { items, businessId, maxAds, taskId } = body ?? {};
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
    // Launch worker for import (ESM)
    const workerPath = path.resolve(process.cwd(), "scripts/importWorker.mjs");
    const worker = new Worker(pathToFileURL(workerPath), {
      workerData: { taskId, items, businessId, maxAds },
      type: 'module'
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
  } catch (err: any) {
    return NextResponse.json(
      { message: err?.message || "Internal server error", saved: 0 },
      { status: 500 }
    );
  }
}

