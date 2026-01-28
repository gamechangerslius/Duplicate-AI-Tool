// Simple in-memory log store for demo (replace with Redis or DB in production)
const logStore: Record<string, string[]> = {};

export function pushLog(taskId: string, message: string) {
  if (!logStore[taskId]) logStore[taskId] = [];
  logStore[taskId].push(message);
}

export function getLogs(taskId: string) {
  return logStore[taskId] || [];
}

export function clearLogs(taskId: string) {
  delete logStore[taskId];
}
