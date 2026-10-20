// Storefront entry points, reached only through the Shopify App Proxy: averyled.com/apps/quote/... → /portal/...
// Shopify signs every request with the signed-in customer's ID; approval is the customer's `approve` tag.
//   /apps/quote                 → sign-in gate, or hand-off into the full Quote Tool as that member
//   /apps/quote?next=/quotes/5  → same, landing on that quote
//   /apps/quote/q/5/buy?mode=…  → add the confirmed proposal to the cart (add) or replace the cart and check out (buy)
//   /apps/quote/q/5/cart        → JSON used by the buy page; always re-checks approval with Shopify
import { verifyProxyRequest, memberAccess, portalConfig, portalConfigured } from '@/lib/shopify-portal';
import { memberHandoffToken, safeMemberNext } from '@/lib/member-session';
import { memberProposal } from '@/lib/portal';
import { gatePage, notFoundPage, launchPage, buyPage } from '@/lib/portal-html';
import { loadPurchaseCart } from '@/lib/purchase-cart';

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

  const access = await memberAccess(proxy.customerId, { config, fresh: isCart || !path.length });
  if (access.state !== 'approved') return isCart ? json({ ok: false, message: 'Partner approval is required to order from proposals.' }, 403) : liquid(gatePage(access.state, proxy.prefix));
  const customerId = proxy.customerId;

  if (!path.length) {
    const token = await memberHandoffToken(customerId);
    if (!token) return liquid(gatePage('unavailable', proxy.prefix), 503);
    const enter = `${config.appOrigin}/member/enter?${new URLSearchParams({ token, next: safeMemberNext(url.searchParams.get('next')) })}`;
    return liquid(launchPage(enter));
  }

  const ordering = path[0] === 'q' && /^\d+$/.test(path[1] || '') && path.length === 3 && ['cart', 'buy'].includes(path[2]);
  if (!ordering) return liquid(notFoundPage(proxy.prefix, 'Page not found.'), 404);
  const found = memberProposal(customerId, Number(path[1]));
  if (!found?.document || !found.state.orderable) return isCart ? json({ ok: false, message: 'Confirm this comparison in the Quote Tool before ordering.' }, 404) : liquid(notFoundPage(proxy.prefix), 404);

  const purchase = await loadPurchaseCart(found.document);
  if (isCart) {
    if (!purchase.items?.length) return json({ ok: false, message: purchase.message || 'This proposal cannot be ordered online. Contact our team.' }, 409);
    return json({ ok: true, items: purchase.items.map((i) => ({ id: i.variantId, quantity: i.quantity })), total: purchase.total });
  }
  if (!purchase.items?.length) return liquid(notFoundPage(proxy.prefix, purchase.message || 'This proposal cannot be ordered online.'), 409);
  return liquid(buyPage({ prefix: proxy.prefix, id: found.quote.id, mode: url.searchParams.get('mode') === 'buy' ? 'buy' : 'add', itemCount: purchase.items.length, total: purchase.total }));
}
