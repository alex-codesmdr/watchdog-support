import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './env';

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
  issuer: string;
}
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

let disc: Promise<Discovery> | undefined;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/** OIDC discovery against the in-cluster issuer; browser redirects use the public issuer URL. */
async function discovery(): Promise<Discovery> {
  disc ??= fetch(`${env().OIDC_ISSUER}/.well-known/openid-configuration`, {
    cache: 'no-store',
  }).then((r) => {
    if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
    return r.json() as Promise<Discovery>;
  });
  return disc;
}
const toPublic = (u: string) =>
  env().OIDC_PUBLIC_ISSUER ? u.replace(env().OIDC_ISSUER, env().OIDC_PUBLIC_ISSUER!) : u;
const b64 = (n: number) => randomBytes(n).toString('base64url');
const redirectUri = () => `${env().PUBLIC_WEB_URL}/auth/callback`;

export async function authorizationUrl(returnTo: string) {
  const d = await discovery();
  const state = b64(24);
  const nonce = b64(24);
  const verifier = b64(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const u = new URL(toPublic(d.authorization_endpoint));
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: env().OIDC_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Ask Keycloak for the MFA level of assurance (acr "mfa" ⇒ password + TOTP).
    acr_values: 'mfa',
  }).toString();
  return { url: u.toString(), state, nonce, verifier, returnTo };
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const d = await discovery();
  const r = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(env().OIDC_CLIENT_ID)}:${encodeURIComponent(env().OIDC_CLIENT_SECRET)}`).toString('base64')}`,
    },
    body: new URLSearchParams(body),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  return r.json() as Promise<TokenSet>;
}

export async function exchangeCode(code: string, verifier: string, nonce: string) {
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  if (!t.id_token) throw new Error('no id_token');
  const d = await discovery();
  jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
  const { payload } = await jwtVerify(t.id_token, jwks, {
    issuer: env().OIDC_PUBLIC_ISSUER ?? d.issuer,
    audience: env().OIDC_CLIENT_ID,
  });
  if (payload.nonce !== nonce) throw new Error('nonce mismatch');
  return { tokens: t, claims: payload as { name?: string; email?: string } };
}

export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

export async function endSessionUrl(idToken: string) {
  const d = await discovery();
  const u = new URL(toPublic(d.end_session_endpoint));
  u.search = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: env().PUBLIC_WEB_URL,
    client_id: env().OIDC_CLIENT_ID,
  }).toString();
  return u.toString();
}
