// utils/import-cancel-file.js
// File-based cancel token store for demo (use Redis for production)
import fs from 'fs';
import path from 'path';

// Use writable temp directory on serverless (Vercel) or project tmp locally
const CANCEL_DIR = (() => {
  const envDir = process.env.CANCEL_DIR;
  if (envDir) return envDir;
  const isVercel = process.env.VERCEL === '1';
  return isVercel ? '/tmp/cancel_tokens' : path.join(process.cwd(), 'tmp_cancel_tokens');
})();

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
