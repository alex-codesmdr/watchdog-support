import { NextResponse, type NextRequest } from 'next/server';

/**
 * Strict CSP with a per-request nonce, and a cheap auth gate for app areas
 * (real authorization is enforced by the API on every call).
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self' " +
      (process.env.OIDC_PUBLIC_ISSUER ?? process.env.OIDC_ISSUER ?? '').replace(/\/realms\/.*/, ''),
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');

  const p = req.nextUrl.pathname;
  const gated = /^\/(portal|workspace|admin)(\/|$)/.test(p);
  const hasSession = req.cookies.has('__Host-wd_sid') || req.cookies.has('wd_sid');
  if (gated && !hasSession) {
    const u = req.nextUrl.clone();
    u.pathname = '/auth/login';
    u.search = `?returnTo=${encodeURIComponent(p)}`;
    return NextResponse.redirect(u);
  }
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  // Next.js reads the nonce from the request CSP header and stamps it on its own <script> tags.
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|auth/).*)'] };
