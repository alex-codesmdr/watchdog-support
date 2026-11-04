import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { Redis } from 'ioredis';
import { env } from './env';
import { refreshTokens } from './oidc';

/**
 * BFF session (ADR-005). Tokens live only in Redis on the server. The browser holds an opaque,
 * HttpOnly, Secure, SameSite=Lax session id. Mutations additionally require a per-session CSRF
 * token in the X-WD-CSRF header plus a same-origin Origin header.
 */
export interface Session {
  id: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number; // epoch seconds of access token expiry
  csrf: string;
  name: string;
  email: string;
  createdAt: number;
}

let redis: Redis | undefined;
const r = () => (redis ??= new Redis(env().SESSION_REDIS_URL, { maxRetriesPerRequest: 2 }));
const key = (id: string) => `wd:sess:${id}`;

export const cookieName = () => (env().SESSION_COOKIE_SECURE ? '__Host-wd_sid' : 'wd_sid');

export async function createSession(
  data: Omit<Session, 'id' | 'csrf' | 'createdAt'>,
): Promise<Session> {
  const s: Session = {
    ...data,
    id: randomBytes(32).toString('base64url'),
    csrf: randomBytes(24).toString('base64url'),
    createdAt: Date.now(),
  };
  await r().set(key(s.id), JSON.stringify(s), 'EX', env().SESSION_TTL_SECONDS);
  (await cookies()).set(cookieName(), s.id, {
    httpOnly: true,
    secure: env().SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: env().SESSION_TTL_SECONDS,
  });
  return s;
}

/** Current session, refreshing the access token when it is about to expire. */
export async function getSession(): Promise<Session | null> {
  const id = (await cookies()).get(cookieName())?.value;
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const raw = await r().get(key(id));
  if (!raw) return null;
  let s = JSON.parse(raw) as Session;
  if (s.expiresAt - 60 < Date.now() / 1000) {
    const t = await refreshTokens(s.refreshToken).catch(() => null);
    if (!t) {
      await r().del(key(id));
      return null;
    }
    s = {
      ...s,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? s.refreshToken,
      idToken: t.id_token ?? s.idToken,
      expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
    };
    await r().set(key(id), JSON.stringify(s), 'KEEPTTL');
  }
  return s;
}

export async function destroySession(): Promise<Session | null> {
  const jar = await cookies();
  const id = jar.get(cookieName())?.value;
  jar.delete(cookieName());
  if (!id) return null;
  const raw = await r().get(key(id));
  await r().del(key(id));
  return raw ? (JSON.parse(raw) as Session) : null;
}

/** Short-lived login transaction (state → PKCE verifier + nonce + return path). */
export async function putLoginTx(
  state: string,
  v: { verifier: string; nonce: string; returnTo: string },
) {
  await r().set(`wd:login:${state}`, JSON.stringify(v), 'EX', 600);
}
export async function takeLoginTx(
  state: string,
): Promise<{ verifier: string; nonce: string; returnTo: string } | null> {
  const raw = await r().getdel(`wd:login:${state}`);
  return raw ? JSON.parse(raw) : null;
}
