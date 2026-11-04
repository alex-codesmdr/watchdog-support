import { NextResponse, type NextRequest } from 'next/server';
import { authorizationUrl } from '@/lib/oidc';
import { putLoginTx } from '@/lib/session';

export const dynamic = 'force-dynamic';

const safeReturn = (v: string | null) => (v && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) ? v : '/portal');

export async function GET(req: NextRequest) {
  const a = await authorizationUrl(safeReturn(req.nextUrl.searchParams.get('returnTo')));
  await putLoginTx(a.state, { verifier: a.verifier, nonce: a.nonce, returnTo: a.returnTo });
  return NextResponse.redirect(a.url);
}
