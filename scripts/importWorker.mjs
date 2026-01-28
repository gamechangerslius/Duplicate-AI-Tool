// scripts/importWorker.mjs
// Node.js worker for import tasks (run with: node scripts/importWorker.mjs)
import { parentPort, workerData } from 'worker_threads';
import { isCancelledFile, clearCancelFile } from '../utils/import-cancel-file.js';

function sendLog(taskId, message) {
  if (parentPort) parentPort.postMessage({ type: 'log', taskId, message });
}

async function runImport(task) {
  const { taskId, items, businessId, maxAds } = task;
  sendLog(taskId, `[worker] [START] Import process initiated.`);
  sendLog(taskId, `[worker] Task ID: ${taskId}`);
  sendLog(taskId, `[worker] Business ID: ${businessId}`);
  sendLog(taskId, `[worker] Total items to process: ${items.length}`);
  sendLog(taskId, `[worker] Max ads allowed: ${maxAds}`);
  sendLog(taskId, `[worker] Working directory: ${process.cwd()}`);
  sendLog(taskId, `[worker] Process PID: ${process.pid}`);
  for (let i = 0; i < items.length; i++) {
    if (isCancelledFile(taskId)) {
      sendLog(taskId, `[worker] [CANCEL] Cancel token detected for task ${taskId}.`);
      sendLog(taskId, `[worker] [CANCEL] Import cancelled by user at item ${i + 1} of ${items.length}.`);
      clearCancelFile(taskId);
      break;
    }
    sendLog(taskId, `[worker] [ITEM] Processing item ${i + 1} of ${items.length}...`);
    sendLog(taskId, `[worker] [ITEM] Item data: ${JSON.stringify(items[i]).slice(0, 500)}`);
    // Simulate processing (replace with real logic)
    await new Promise(r => setTimeout(r, 500));
    sendLog(taskId, `[worker] [ITEM] Finished processing item ${i + 1}.`);
  }
  if (!isCancelledFile(taskId)) {
    sendLog(taskId, `[worker] [COMPLETE] Import finished for business ${businessId}. All items processed.`);
  }
  sendLog(taskId, `[worker] [SHUTDOWN] Worker process exiting for task ${taskId}.`);
  if (parentPort) parentPort.postMessage({ type: 'done', taskId });
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    // No-op: cancel now handled via file
    if (msg && msg.type === 'import') {
      await runImport(msg.task);
    }
  });
  if (workerData) runImport(workerData);
}
