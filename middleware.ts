// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './app/lib/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/login') || pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  // the session cookie must carry a valid signature — a hand-typed cookie doesn't pass
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/logs', '/logs/:path*', '/shade-capture', '/shade-capture/:path*', '/activity', '/analytics', '/analytics/:path*', '/meta-ads', '/meta-ads/:path*', '/api/meta-ads', '/api/meta-ads/:path*', '/audit', '/api/audit/:path*'], // <— added /audit and its API
};
