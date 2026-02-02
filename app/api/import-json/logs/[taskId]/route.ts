import { NextRequest } from "next/server";

// Run SSE streaming in Node runtime to avoid Edge/fs and long-request timeouts
export const runtime = 'nodejs';
import { getLogs, clearLogs } from "@/utils/sse-logs";
// Use file-based cancel token to allow cross-invocation signalling (server-friendly import)
// Path is relative to this file: app/api/import-json/logs/[taskId]/route.ts → ../../utils/import-cancel-file.js
const cancelFileModPromise = import('../../utils/import-cancel-file.js');

// Stream flush interval (ms). Can be overridden via env var SSE_TICK_MS.
const TICK_MS = (() => { const v = Number(process.env.SSE_TICK_MS); return Number.isFinite(v) && v > 0 ? v : 5000; })();

function nowStamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}]`;
}

export async function GET(req: NextRequest, { params }: { params: { taskId: string } }) {
  const { taskId } = params;
  return new Response(
    new ReadableStream({
      async start(controller) {
        let lastIdx = 0;
        let finished = false;
        controller.enqueue(`data: ${nowStamp()} Log stream started for task ${taskId}\n\n`);
        const cancelFileMod = await cancelFileModPromise;
        const isCancelledFile = cancelFileMod.isCancelledFile as (id: string) => boolean;
        const clearCancelFile = cancelFileMod.clearCancelFile as (id: string) => void;
        while (!finished) {
          const logs = getLogs(taskId);
          // Send new logs
          while (lastIdx < logs.length) {
            controller.enqueue(`data: ${logs[lastIdx]}\n\n`);
            // If log signals cancel or finish, end stream
            if (logs[lastIdx].includes('⏹️ Import cancelled by user.') || logs[lastIdx].includes('✅ Import complete')) {
              finished = true;
            }
            lastIdx++;
          }
          if (finished || isCancelledFile(taskId)) {
            if (isCancelledFile(taskId)) {
              controller.enqueue(`data: ${nowStamp()} ⏹️ Import cancelled by user.\n\n`);
              try {
                clearLogs(taskId);
                clearCancelFile(taskId);
              } catch (e) {
                // ignore
              }
            }
            break;
          }
          await new Promise(r => setTimeout(r, TICK_MS));
        }
        controller.enqueue(`data: ${nowStamp()} Log stream finished\n\n`);
        controller.close();
      }
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    }
  );
}
