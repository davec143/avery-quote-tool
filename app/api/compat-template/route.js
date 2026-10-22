import { requireAdmin } from '@/lib/access';
import { compatTemplateCsv } from '@/lib/compat';

export async function GET() {
  await requireAdmin();
  return new Response(compatTemplateCsv(), {
    headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="compatibility-list-template.csv"' },
  });
}
