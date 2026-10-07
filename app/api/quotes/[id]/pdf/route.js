import { requireAuth } from '@/lib/auth';
import fs from 'node:fs';
import { db } from '@/lib/db';

export async function GET(_req, { params }) {
  await requireAuth();
  const { id } = await params;
  const q = db().prepare('SELECT file_path, filename FROM quotes WHERE id = ?').get(Number(id));
  if (!q?.file_path || !fs.existsSync(q.file_path)) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(q.file_path), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${encodeURIComponent(q.filename || 'quote.pdf')}"` },
  });
}
