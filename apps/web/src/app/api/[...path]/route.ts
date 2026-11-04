import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PUBLIC = [
  /^v1\/public\//,
  /^v1\/catalog\/(families|products)$/,
  /^v1\/files\//,
  /^v1\/kb\/(search|suggest|articles\/[a-z0-9-]+(\/feedback)?)$/,
  /^v1\/downloads(\/(releases|eulas)\/[0-9a-f-]{36}|\/files\/[0-9a-f-]{36}\/link)?$/,
];
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Only these request headers are forwarded (tus + content negotiation).
const FORWARD = [
  'accept',
  'content-type',
  'content-length',
  'if-match',
  'tus-resumable',
  'upload-length',
  'upload-offset',
  'upload-metadata',
  'upload-defer-length',
  'x-request-id',
];
const EXPOSE = [
  'content-type',
  'content-disposition',
  'location',
  'tus-resumable',
  'upload-offset',
  'upload-length',
  'tus-version',
  'tus-max-size',
  'tus-extension',
  'retry-after',
  'ratelimit-remaining',
  'cache-control',
];

/**
 * Same-origin API proxy: attaches the server-held access token. Browsers never see tokens.
 * Mutations require same-origin Origin + the session CSRF token.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = path.join('/');
  if (path.some((p) => p === '..' || p.includes('\\')))
    return NextResponse.json({ title: 'Bad request' }, { status: 400 });
  const isPublic = PUBLIC.some((re) => re.test(sub));
  const s = await getSession();
  if (!SAFE.has(req.method)) {
    if (req.headers.get('origin') !== env().PUBLIC_WEB_URL)
      return NextResponse.json({ title: 'Cross-site request blocked' }, { status: 403 });
    if (!isPublic && (!s || req.headers.get('x-wd-csrf') !== s.csrf))
      return NextResponse.json(
        { title: 'Your session expired. Reload the page.' },
        { status: 403 },
      );
  }
  if (!isPublic && !s)
    return NextResponse.json(
      { type: 'about:blank', title: 'Authentication required', status: 401 },
      { status: 401 },
    );

  const headers = new Headers();
  for (const h of FORWARD) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (s) headers.set('authorization', `Bearer ${s.accessToken}`);
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers.set('x-forwarded-for', fwd);

  const upstream = await fetch(`${env().API_INTERNAL_URL}/api/${sub}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: SAFE.has(req.method) ? undefined : req.body,
    // @ts-expect-error -- Node fetch requires duplex for streamed request bodies (tus chunks)
    duplex: 'half',
    redirect: 'manual',
    cache: 'no-store',
  });
  const out = new Headers();
  for (const h of EXPOSE) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: out });
}

export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as PUT,
  handle as HEAD,
  handle as DELETE,
  handle as OPTIONS,
};
