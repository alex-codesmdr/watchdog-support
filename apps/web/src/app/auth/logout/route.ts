import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { endSessionUrl } from '@/lib/oidc';
import { destroySession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** POST only (form with CSRF token) so a third-party page cannot log users out. */
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== env().PUBLIC_WEB_URL)
    return new NextResponse(null, { status: 403 });
  const s = await destroySession();
  const form = await req.formData().catch(() => null);
  if (s && form?.get('csrf') !== s.csrf) return new NextResponse(null, { status: 403 });
  const to = s?.idToken
    ? await endSessionUrl(s.idToken).catch(() => env().PUBLIC_WEB_URL)
    : env().PUBLIC_WEB_URL;
  return NextResponse.redirect(to, { status: 303 });
}
