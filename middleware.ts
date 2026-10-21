// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession, META_ADS_ONLY, META_ADS_ONLY_PATHS } from './app/lib/session';

// API routes that need a signed-in session. Other API routes keep working without one (as before) — some may be
// called from outside the dashboard — but signed-in Meta-Ads-only users are still kept out of them.
const PROTECTED_API = ['/api/audit', '/api/meta-ads'];
const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api/');
  // the session cookie must carry a valid signature — a hand-typed cookie doesn't pass
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!user) {
    if (isApi) {
      return PROTECTED_API.some((b) => under(pathname, b))
        ? NextResponse.json({ error: 'Not signed in' }, { status: 401 })
        : NextResponse.next();
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Meta-Ads-only users (riddhi): home, /meta-ads and its API — nothing else
  if (META_ADS_ONLY.has(user) && !META_ADS_ONLY_PATHS(pathname)) {
    if (isApi) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = '/meta-ads';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // every page and API route; skips Next.js internals and static files (anything with a file extension)
  matcher: ['/((?!_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
