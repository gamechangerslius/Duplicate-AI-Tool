import { NextRequest } from "next/server";
import { getLogs } from "@/utils/sse-logs";
import { isCancelled } from "@/utils/import-cancel";

export async function GET(req: NextRequest, { params }: { params: { taskId: string } }) {
  const { taskId } = params;
  return new Response(
    new ReadableStream({
      async start(controller) {
        let lastIdx = 0;
        let finished = false;
        controller.enqueue(`data: Log stream started for task ${taskId}\n\n`);
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
          if (finished || isCancelled(taskId)) break;
          await new Promise(r => setTimeout(r, 500));
        }
        controller.enqueue(`data: Log stream finished\n\n`);
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
