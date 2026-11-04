import { NextResponse, type NextRequest } from 'next/server';
import { authorizationUrl } from '@/lib/oidc';
import { safeReturn } from '@/lib/redirect';
import { putLoginTx } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const a = await authorizationUrl(safeReturn(req.nextUrl.searchParams.get('returnTo')));
  await putLoginTx(a.state, { verifier: a.verifier, nonce: a.nonce, returnTo: a.returnTo });
  return NextResponse.redirect(a.url);
}
