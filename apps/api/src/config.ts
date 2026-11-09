import { apiEnvSchema, loadEnv, type ApiEnv } from '@wd/config';

export type AppConfig = ApiEnv;

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const cfg = loadEnv(apiEnvSchema, source);
  if (cfg.NODE_ENV === 'production') {
    if (cfg.AV_MODE !== 'clamav') throw new Error('AV_MODE=skip is not allowed in production');
    if (cfg.IDENTITY_PROVISIONER !== 'keycloak')
      throw new Error('IDENTITY_PROVISIONER must be keycloak in production');
    if (!cfg.AUTH_REQUIRE_MFA) throw new Error('AUTH_REQUIRE_MFA cannot be disabled in production');
    if (cfg.WEBHOOK_ALLOW_PRIVATE_TARGETS)
      throw new Error('WEBHOOK_ALLOW_PRIVATE_TARGETS must be false in production');
    if (
      /dev-only|replace-me|change-me/i.test(cfg.APP_SIGNING_KEY) ||
      cfg.APP_SIGNING_KEY.length < 48
    )
      throw new Error(
        'APP_SIGNING_KEY must be a fresh random value of at least 48 characters in production',
      );
    if (cfg.STORAGE_DRIVER !== 's3') throw new Error('STORAGE_DRIVER must be s3 in production');
    if (/\.example\b/.test(cfg.MAIL_FROM) || cfg.SMTP_HOST === 'localhost')
      throw new Error('Set MAIL_FROM and SMTP_HOST to real values in production');
    if (cfg.JIRA_MODE === 'cloud' && !cfg.JIRA_API_TOKEN)
      throw new Error('JIRA_API_TOKEN is required');
    if (cfg.ASSISTANT_MODE === 'anthropic' && !cfg.ANTHROPIC_API_KEY)
      throw new Error('ANTHROPIC_API_KEY is required when ASSISTANT_MODE=anthropic');
  }
  return cfg;
}
