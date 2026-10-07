import { requireAuth } from '@/lib/auth';
import Papa from 'papaparse';
import { listCompat, COMPAT_HEADERS } from '@/lib/compat';

export async function GET() {
  await requireAuth();
  const rows = listCompat().map((r) => COMPAT_HEADERS.map((h) => r[h] ?? ''));
  return new Response(Papa.unparse([COMPAT_HEADERS, ...rows]), {
    headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="compatibility-list.csv"' },
  });
}
