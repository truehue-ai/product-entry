// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/login') || pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('th_auth');
  if (!cookie?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/logs', '/logs/:path*', '/shade-capture', '/activity', '/audit', '/api/audit/:path*'], // <— added /audit and its API
};
