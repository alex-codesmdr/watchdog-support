import 'server-only';
import { redirect } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { api, ApiError } from './api';
import { getSession } from './session';

export type MeResult = { me: Me } | { blocked: string };

/** Resolves the signed-in user, or the reason they cannot use the portal yet (pending org, disabled). */
export async function loadMe(returnTo: string): Promise<MeResult> {
  if (!(await getSession())) redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  try {
    return { me: await api<Me>('/api/v1/me') };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 401))
      return {
        blocked: e.problem.detail ?? e.problem.title ?? 'Your account cannot use the portal yet.',
      };
    throw e;
  }
}
