import 'server-only';
import { redirect } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { env } from './env';
import { getSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { title?: string; detail?: string },
  ) {
    super(problem.title ?? `API ${status}`);
  }
}

/** Server-side API call for React Server Components, carrying the session's access token. */
export async function api<T>(
  path: string,
  init: RequestInit & { public?: boolean } = {},
): Promise<T> {
  const s = init.public ? null : await getSession();
  if (!init.public && !s)
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(path.startsWith('/api') ? '/portal' : path)}`,
    );
  const r = await fetch(`${env().API_INTERNAL_URL}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(s ? { authorization: `Bearer ${s.accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json() as Promise<T>;
}

export async function currentUser(): Promise<Me | null> {
  const s = await getSession();
  if (!s) return null;
  try {
    return await api<Me>('/api/v1/me');
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<Me> {
  const me = await currentUser();
  if (!me) redirect('/auth/login');
  return me;
}
