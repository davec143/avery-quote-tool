import { NextResponse } from 'next/server';
import { validSession } from './lib/session.js';
import { MEMBER_COOKIE, MEMBER_MARKER, verifyMemberSession, memberPathAllowed, safeMemberNext } from './lib/member-session.js';

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  // Trailing-slash redirects are off so Shopify's proxied /portal/ works; keep them for every other page.
  if (pathname.length > 1 && pathname.endsWith('/') && !pathname.startsWith('/portal')) {
    return NextResponse.redirect(new URL(`${pathname.replace(/\/+$/, '') || '/'}${req.nextUrl.search}`, req.url), 308);
  }
  // Shopify-proxied pages (averyled.com/apps/quote) and the member sign-in hand-off authenticate themselves.
  if (pathname === '/portal' || pathname.startsWith('/portal/') || pathname === '/member/enter' || pathname === '/member/signout') return NextResponse.next();
  if (pathname === '/login' || pathname.startsWith('/_next/') || ['/favicon.ico', '/icon.png', '/avery-logo.png', '/avery-logo-light.png'].includes(pathname)) return NextResponse.next();
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === 'production') return new NextResponse('Set APP_PASSWORD before using the production quote tool.', { status: 503 });
    return NextResponse.next();
  }
  if (await validSession(req.cookies.get('aq_session')?.value, password)) return NextResponse.next();
  // Members: only member pages and quote pages; each page and action then checks the quote belongs to them.
  const member = await verifyMemberSession(req.cookies.get(MEMBER_COOKIE)?.value);
  if (member && memberPathAllowed(pathname)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return new NextResponse('Authentication required', { status: 401 });
  const wasMember = req.cookies.has(MEMBER_COOKIE) || req.cookies.has(MEMBER_MARKER);
  if (member || pathname === '/m' || pathname.startsWith('/m/') || (wasMember && memberPathAllowed(pathname))) {
    // A member on a team page, or a member whose session ended: back through averyled.com sign-in,
    // returning to the same quote when that page is one members can open.
    const store = `${(process.env.PORTAL_STOREFRONT_URL || 'https://averyled.com').replace(/\/+$/, '')}${process.env.PORTAL_PROXY_PATH || '/apps/quote'}`;
    const next = safeMemberNext(pathname);
    return NextResponse.redirect(next !== '/m' ? `${store}?next=${encodeURIComponent(next)}` : store);
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
