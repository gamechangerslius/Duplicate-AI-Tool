// utils/import-cancel.ts
// In-memory cancel token store for import tasks (demo; use Redis for production)
const cancelTokens: Record<string, boolean> = {};

export function requestCancel(taskId: string) {
  cancelTokens[taskId] = true;
}

export function isCancelled(taskId: string) {
  return !!cancelTokens[taskId];
}

export function clearCancel(taskId: string) {
  delete cancelTokens[taskId];
}
