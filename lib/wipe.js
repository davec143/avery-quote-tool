// Admin reset: removes every quote (lines, history, logos, uploaded source files) and the member usage log.
// Catalog, compatibility list, product specs and settings are kept.
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR } from './db.js';

export function wipeQuotes() {
  const d = db();
  const files = d.prepare('SELECT file_path FROM quotes WHERE file_path IS NOT NULL').all().map((r) => r.file_path);
  const count = d.transaction(() => {
    const n = d.prepare('SELECT COUNT(*) AS n FROM quotes').get().n;
    d.prepare('DELETE FROM quotes').run(); // quote_lines and quote_events cascade
    d.prepare("DELETE FROM blobs WHERE key LIKE 'quote_logo_%'").run();
    d.prepare('DELETE FROM member_usage').run();
    return n;
  })();
  const root = path.resolve(UPLOAD_DIR);
  for (const file of files) {
    const resolved = path.resolve(file);
    if (resolved.startsWith(root + path.sep)) fs.rm(resolved, { force: true }, () => {});
  }
  return count;
}
