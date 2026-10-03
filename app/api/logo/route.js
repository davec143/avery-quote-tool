import fs from 'node:fs';
import path from 'node:path';
import { getBlob } from '@/lib/db';

// Uploaded logo if there is one, otherwise the bundled Avery LED logo.
export async function GET() {
  const b = getBlob('logo');
  if (b) return new Response(b.data, { headers: { 'content-type': b.mime, 'cache-control': 'no-cache' } });
  const file = fs.readFileSync(path.join(process.cwd(), 'public', 'avery-logo.png'));
  return new Response(file, { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } });
}
