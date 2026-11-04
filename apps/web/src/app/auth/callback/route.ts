import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { exchangeCode } from '@/lib/oidc';
import { createSession, takeLoginTx } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const base = env().PUBLIC_WEB_URL;
  const p = req.nextUrl.searchParams;
  const state = p.get('state');
  const code = p.get('code');
  if (p.get('error') || !state || !code) return NextResponse.redirect(`${base}/?signin=failed`);
  const tx = await takeLoginTx(state);
  if (!tx) return NextResponse.redirect(`${base}/?signin=expired`);
  try {
    const { tokens, claims } = await exchangeCode(code, tx.verifier, tx.nonce);
    await createSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      idToken: tokens.id_token ?? '',
      expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
      name: claims.name ?? claims.email ?? '',
      email: claims.email ?? '',
    });
  } catch {
    return NextResponse.redirect(`${base}/?signin=failed`);
  }
  return NextResponse.redirect(`${base}${tx.returnTo}`);
}
