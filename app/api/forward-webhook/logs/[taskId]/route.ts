import { NextRequest } from "next/server";
import { getLogs, clearLogs } from '@/utils/sse-logs';
// Switch to file-based cancel token for consistency with worker (server-friendly import)
// Path: app/api/forward-webhook/logs/[taskId]/route.ts → ../../../import-json/utils/import-cancel-file.js
const cancelFileModPromise = import('../../../import-json/utils/import-cancel-file.js');

function nowStamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}]`;
}

// Stream flush interval (ms). Can be overridden via env var SSE_TICK_MS.
const TICK_MS = (() => { const v = Number(process.env.SSE_TICK_MS); return Number.isFinite(v) && v > 0 ? v : 5000; })();

export async function GET(req: NextRequest, { params }: { params: { taskId: string } }) {
  const { taskId } = params;
  return new Response(
    new ReadableStream({
      async start(controller) {
        let lastIdx = 0;
        let finished = false;
        const cancelFileMod = await cancelFileModPromise;
        const isCancelledFile = cancelFileMod.isCancelledFile as (id: string) => boolean;
        const clearCancelFile = cancelFileMod.clearCancelFile as (id: string) => void;
        while (!finished) {
          const logs = getLogs(taskId);
          while (lastIdx < logs.length) {
            controller.enqueue(`data: ${logs[lastIdx]}\n\n`);
            if (logs[lastIdx].includes('⏹️') || logs[lastIdx].toLowerCase().includes('complete') || logs[lastIdx].toLowerCase().includes('failed')) {
              // heuristics to detect finish
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
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    }
  );
}
