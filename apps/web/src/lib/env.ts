import 'server-only';
import { loadEnv, webEnvSchema, type WebEnv } from '@wd/config';

let cached: WebEnv | undefined;
export function env(): WebEnv {
  if (!cached) {
    const e = loadEnv(webEnvSchema);
    // Served over https means really hosted; a local http preview may use demo settings.
    if (e.NODE_ENV === 'production' && e.PUBLIC_WEB_URL.startsWith('https://')) {
      if (!e.SESSION_COOKIE_SECURE)
        throw new Error('SESSION_COOKIE_SECURE must be true in production');
      if (/change-me/i.test(e.OIDC_CLIENT_SECRET))
        throw new Error('Set a real OIDC_CLIENT_SECRET in production');
    }
    cached = e;
  }
  return cached;
}
