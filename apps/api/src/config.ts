import { apiEnvSchema, loadEnv, type ApiEnv } from '@wd/config';

export type AppConfig = ApiEnv;

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const cfg = loadEnv(apiEnvSchema, source);
  if (cfg.NODE_ENV === 'production') {
    if (cfg.AV_MODE !== 'clamav') throw new Error('AV_MODE=skip is not allowed in production');
    if (cfg.IDENTITY_PROVISIONER !== 'keycloak') throw new Error('IDENTITY_PROVISIONER must be keycloak in production');
    if (!cfg.AUTH_REQUIRE_MFA) throw new Error('AUTH_REQUIRE_MFA cannot be disabled in production');
  }
  return cfg;
}
