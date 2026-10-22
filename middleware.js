import { NextResponse } from 'next/server';
import { MEMBER_COOKIE, verifyMemberSession, safeMemberNext } from './lib/member-session.js';

// Everyone signs in through averyled.com (Shopify). This only checks for a valid session cookie;
// each page then decides what that person may see (own quotes for members, everything for admins).
export async function middleware(req) {
  const { pathname } = req.nextUrl;
  // Trailing-slash redirects are off so Shopify's proxied /portal/ works; keep them for every other page.
  if (pathname.length > 1 && pathname.endsWith('/') && !pathname.startsWith('/portal')) {
    return NextResponse.redirect(new URL(`${pathname.replace(/\/+$/, '') || '/'}${req.nextUrl.search}`, req.url), 308);
  }
  // Shopify-proxied pages (averyled.com/apps/quote) and the sign-in hand-off authenticate themselves.
  if (pathname === '/portal' || pathname.startsWith('/portal/') || pathname === '/member/enter' || pathname === '/member/signout') return NextResponse.next();
  if (pathname.startsWith('/_next/') || ['/favicon.ico', '/icon.png', '/avery-logo.png', '/avery-logo-light.png'].includes(pathname)) return NextResponse.next();
  if (await verifyMemberSession(req.cookies.get(MEMBER_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return new NextResponse('Sign in at averyled.com to use the Quote Tool.', { status: 401 });
  // No session, or an expired one: back through averyled.com sign-in, returning to the same quote when possible.
  const store = `${(process.env.PORTAL_STOREFRONT_URL || 'https://averyled.com').replace(/\/+$/, '')}${process.env.PORTAL_PROXY_PATH || '/apps/quote'}`;
  const next = safeMemberNext(pathname);
  return NextResponse.redirect(next !== '/m' ? `${store}?next=${encodeURIComponent(next)}` : store);
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
