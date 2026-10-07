import { NextResponse } from 'next/server';
import { validSession } from './lib/session.js';

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname.startsWith('/_next/') || ['/favicon.ico', '/avery-logo.png', '/avery-logo-light.png'].includes(pathname)) return NextResponse.next();
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === 'production') return new NextResponse('Set APP_PASSWORD before using the production quote tool.', { status: 503 });
    return NextResponse.next();
  }
  if (await validSession(req.cookies.get('aq_session')?.value, password)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return new NextResponse('Authentication required', { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
