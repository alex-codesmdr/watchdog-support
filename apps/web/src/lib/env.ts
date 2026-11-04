import 'server-only';
import { loadEnv, webEnvSchema, type WebEnv } from '@wd/config';

let cached: WebEnv | undefined;
export function env(): WebEnv {
  cached ??= loadEnv(webEnvSchema);
  return cached;
}
