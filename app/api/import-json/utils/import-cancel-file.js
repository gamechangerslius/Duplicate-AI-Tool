// utils/import-cancel-file.js
// File-based cancel token store for demo (use Redis for production)
import fs from 'fs';
import path from 'path';

// Always use project root for cancel tokens (ESM compatible)
const __filename = import.meta.url.startsWith('file://') ? new URL(import.meta.url).pathname : __filename;
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');
const CANCEL_DIR = path.join(PROJECT_ROOT, 'tmp_cancel_tokens');

export function requestCancelFile(taskId) {
  if (!fs.existsSync(CANCEL_DIR)) fs.mkdirSync(CANCEL_DIR, { recursive: true });
  fs.writeFileSync(path.join(CANCEL_DIR, taskId), 'cancel', 'utf8');
}

export function isCancelledFile(taskId) {
  return fs.existsSync(path.join(CANCEL_DIR, taskId));
}

export function clearCancelFile(taskId) {
  const file = path.join(CANCEL_DIR, taskId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
