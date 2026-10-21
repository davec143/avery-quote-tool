// Exchanges the 5-minute hand-off token from averyled.com/apps/quote for a member session on this site.
import { verifyMemberHandoff, memberSessionToken, MEMBER_COOKIE, MEMBER_MARKER, MEMBER_SESSION_SECONDS, safeMemberNext } from '@/lib/member-session';
import { memberAccess, portalConfig, portalConfigured } from '@/lib/shopify-portal';

export const dynamic = 'force-dynamic';

// Each hand-off token works once (single Railway instance; tokens also expire after five minutes).
const used = new Map();
function firstUse(token) {
  const now = Date.now();
  for (const [t, at] of used) if (now - at > 10 * 60 * 1000) used.delete(t);
  if (used.has(token)) return false;
  used.set(token, now);
  return true;
}
export const runtime = 'nodejs';

export async function GET(request) {
  const config = portalConfig();
  const url = new URL(request.url);
  const back = `${config.storefront}${config.proxyPath}`;
  if (!portalConfigured(config)) return new Response('The member Quote Tool is not available yet.', { status: 503 });
  const handoff = url.searchParams.get('token') || '';
  const customerId = await verifyMemberHandoff(handoff);
  if (!customerId || !firstUse(handoff)) return Response.redirect(back, 303);
  const access = await memberAccess(customerId, { config, fresh: true });
  if (access.state !== 'approved') return Response.redirect(back, 303);
  const token = await memberSessionToken(customerId);
  const next = safeMemberNext(url.searchParams.get('next'));
  const headers = new Headers({ Location: `${config.appOrigin}${next}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', `${MEMBER_COOKIE}=${token}; Path=/; Max-Age=${MEMBER_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
  headers.append('Set-Cookie', `${MEMBER_MARKER}=1; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 303, headers });
}
