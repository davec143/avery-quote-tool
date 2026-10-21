import { NextResponse } from 'next/server';
import { validSession } from './lib/session.js';
import { MEMBER_COOKIE, verifyMemberSession, memberPathAllowed } from './lib/member-session.js';

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  // Shopify-proxied pages (averyled.com/apps/quote) and the member sign-in hand-off authenticate themselves.
  if (pathname === '/portal' || pathname.startsWith('/portal/') || pathname === '/member/enter') return NextResponse.next();
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
  if (member || pathname === '/m' || pathname.startsWith('/m/')) {
    // A member on a team page, or a member whose session ended: send them back through averyled.com sign-in.
    return NextResponse.redirect(`${(process.env.PORTAL_STOREFRONT_URL || 'https://averyled.com').replace(/\/+$/, '')}${process.env.PORTAL_PROXY_PATH || '/apps/quote'}`);
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
