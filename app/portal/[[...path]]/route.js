// Customer-facing pages, reached only through the Shopify App Proxy: averyled.com/apps/quote/... → /portal/...
// No team password here: each request must carry a valid Shopify proxy signature and an approved customer.
import { verifyProxyRequest, memberAccess, portalConfig, portalConfigured, uploadToken } from '@/lib/shopify-portal';
import { listMemberQuotes, memberProposal } from '@/lib/portal';
import { dashboardPage, gatePage, notFoundPage, proposalPage } from '@/lib/portal-html';
import { loadSpecSheets } from '@/lib/spec-sheets';
import { loadPurchaseCart } from '@/lib/purchase-cart';
import { todayEastern } from '@/lib/readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };
const liquid = (body, status = 200) => new Response(body, { status, headers: { ...PRIVATE, 'Content-Type': 'application/liquid; charset=utf-8' } });
const json = (body, status = 200) => Response.json(body, { status, headers: PRIVATE });

export async function GET(request, { params }) {
  const config = portalConfig();
  const url = new URL(request.url);
  const path = (await params).path || [];
  const isCart = path.length === 3 && path[0] === 'q' && path[2] === 'cart';
  if (!portalConfigured(config)) return isCart ? json({ ok: false, message: 'The Quote Tool is not available yet.' }, 503) : new Response('Not found', { status: 404 });
  const proxy = verifyProxyRequest(url.searchParams, { config });
  if (!proxy) return isCart ? json({ ok: false, message: 'Refresh the page and try again.' }, 401) : new Response('Unauthorized', { status: 401 });

  // The cart check always re-verifies approval with Shopify; pages may use a one-minute cache.
  const access = await memberAccess(proxy.customerId, { config, fresh: isCart });
  if (access.state !== 'approved') return isCart ? json({ ok: false, message: 'Partner approval is required to order from proposals.' }, 403) : liquid(gatePage(access.state, proxy.prefix));
  const customerId = proxy.customerId;

  if (!path.length) {
    return liquid(dashboardPage({
      prefix: proxy.prefix, member: access.member, quotes: listMemberQuotes(customerId),
      uploadUrl: `${config.appOrigin}/portal-upload`, token: uploadToken(customerId, { config }), flash: url.searchParams.get('notice') || '',
    }));
  }
  if (path[0] !== 'q' || !/^\d+$/.test(path[1] || '') || path.length > 3 || (path.length === 3 && !isCart)) return liquid(notFoundPage(proxy.prefix, 'Page not found.'), 404);

  const found = memberProposal(customerId, Number(path[1]));
  if (!found?.document) return isCart ? json({ ok: false, message: 'This proposal is not available to order.' }, 404) : liquid(notFoundPage(proxy.prefix), 404);
  const { document } = found;
  const expired = !!document.quote.valid_until && document.quote.valid_until < todayEastern();

  if (isCart) {
    if (expired) return json({ ok: false, message: 'This proposal has expired. Contact our team for updated pricing.' }, 409);
    const purchase = await loadPurchaseCart(document);
    if (!purchase.items?.length) return json({ ok: false, message: purchase.message || 'This proposal cannot be ordered online. Contact our team.' }, 409);
    return json({ ok: true, items: purchase.items.map((i) => ({ id: i.variantId, quantity: i.quantity })), total: purchase.total });
  }

  const [specSheets, purchase] = await Promise.all([
    loadSpecSheets(document.comparison.orders.map((o) => o.sku)),
    expired ? Promise.resolve({ items: [], message: '' }) : loadPurchaseCart(document),
  ]);
  return liquid(proposalPage({ prefix: proxy.prefix, id: found.quote.id, document, specSheets, purchase, expired }));
}
