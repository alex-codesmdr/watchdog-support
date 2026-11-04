'use client';

/** Browser → BFF calls. Adds the CSRF header for mutations and turns problem+json into errors. */
export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: Array<{ path: string; message: string }>,
  ) {
    super(title);
  }
}

let csrf: Promise<string | null> | undefined;
export function getCsrf(): Promise<string | null> {
  csrf ??= fetch('/auth/session', { cache: 'no-store' })
    .then((r) => r.json())
    .then((j: { csrf?: string }) => j.csrf ?? null)
    .catch(() => null);
  return csrf;
}

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...(init.headers ?? {}) };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    const token = await getCsrf();
    if (token) headers['x-wd-csrf'] = token;
  }
  const r = await fetch(`/api${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new ClientApiError(r.status, j.title ?? 'Something went wrong', j.detail, j.errors);
  return j as T;
}
