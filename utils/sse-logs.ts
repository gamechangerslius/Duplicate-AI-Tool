// Simple in-memory log store for demo (replace with Redis or DB in production)
const logStore: Record<string, string[]> = {};

export function pushLog(taskId: string, message: string) {
  if (!logStore[taskId]) logStore[taskId] = [];
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const stamped = `[${hh}:${mm}:${ss}] ${message}`;
  logStore[taskId].push(stamped);
}

export function getLogs(taskId: string) {
  return logStore[taskId] || [];
}

export function clearLogs(taskId: string) {
  delete logStore[taskId];
}
