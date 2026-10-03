import { NextResponse } from 'next/server';

export async function sessionToken(password) {
  const data = new TextEncoder().encode(`avery-quote-tool:${password}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(req) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // no password set = open (local testing only)
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();
  const cookie = req.cookies.get('aq_session')?.value;
  if (cookie && cookie === (await sessionToken(password))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
