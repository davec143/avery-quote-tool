// Direct upload target for the member portal form. File bodies do not go through the Shopify App Proxy,
// so the form carries a short-lived signed token issued by a verified proxy page. Approval is re-checked here.
import { portalConfig, portalConfigured, verifyUploadToken, memberAccess } from '@/lib/shopify-portal';
import { createMemberQuotes, memberSubmissionsToday, MEMBER_DAILY_LIMIT } from '@/lib/portal';
import { validateUploads, sourceMime } from '@/lib/uploads';
import { listCatalog } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request) {
  const config = portalConfig();
  const back = (notice) => Response.redirect(`${config.storefront}${config.proxyPath}?notice=${notice}`, 303);
  if (!portalConfigured(config)) return back('unavailable');
  let form;
  try { form = await request.formData(); } catch { return back('files'); }
  const customerId = verifyUploadToken(String(form.get('token') || ''), { config });
  if (!customerId) return back('expired');
  const access = await memberAccess(customerId, { config, fresh: true });
  if (access.state !== 'approved') return back(access.state === 'unavailable' ? 'unavailable' : 'access');

  const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size);
  try { validateUploads(files); } catch { return back('files'); }
  if (memberSubmissionsToday(customerId) + files.length > MEMBER_DAILY_LIMIT) return back('limit');
  if (!listCatalog().length) return back('unavailable');
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer().then((b) => Buffer.from(b))));
  try { buffers.forEach((b, i) => sourceMime(files[i].name, b)); } catch { return back('type'); }

  await createMemberQuotes(access.member, files.map((f, i) => ({ name: f.name, buffer: buffers[i] })), {
    project: form.get('project') || '', note: form.get('note') || '',
  });
  return back('submitted');
}
