import { requireAuth } from '@/lib/auth';
import { compatTemplateCsv } from '@/lib/compat';

export async function GET() {
  await requireAuth();
  return new Response(compatTemplateCsv(), {
    headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="compatibility-list-template.csv"' },
  });
}
