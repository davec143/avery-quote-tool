import { currentActor, quoteAccessForRoute } from '@/lib/access';
import fs from 'node:fs';
import path from 'node:path';
import { getBlob } from '@/lib/db';

// Uploaded logo if there is one, otherwise the bundled Avery LED logo.
export async function GET(req) {
  const quote = new URL(req.url).searchParams.get('quote');
  if (!(await currentActor()) || (quote && !(await quoteAccessForRoute(quote)))) return new Response('Not found', { status: 404 });
  const b = quote && /^\d+$/.test(quote) ? getBlob(`quote_logo_${quote}`) : getBlob('logo');
  if (b) return new Response(b.data, { headers: { 'content-type': b.mime, 'cache-control': 'no-cache' } });
  const file = fs.readFileSync(path.join(process.cwd(), 'public', 'avery-logo.png'));
  return new Response(file, { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } });
}
