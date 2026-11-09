import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const prod = {
  NODE_ENV: 'production',
  AUTH_ISSUER: 'https://id.apolloinfoways.in/realms/watchdog',
  DATABASE_URL: 'postgres://u:p@db:5432/watchdog',
  REDIS_URL: 'redis://redis:6379',
  APP_SIGNING_KEY: 'k'.repeat(64),
  AV_MODE: 'clamav',
  IDENTITY_PROVISIONER: 'keycloak',
  AUTH_REQUIRE_MFA: 'true',
  STORAGE_DRIVER: 's3',
  SMTP_HOST: 'smtp.apolloinfoways.in',
  MAIL_FROM: 'WatchDog Support <support@apolloinfoways.in>',
};

describe('production configuration safeguards', () => {
  it('accepts a real production configuration', () => {
    expect(() => loadConfig({ ...prod })).not.toThrow();
  });
  it.each([
    [
      'development signing key',
      { APP_SIGNING_KEY: 'dev-only-signing-key-replace-me-0123456789abcdef' },
    ],
    ['private webhook targets', { WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true' }],
    ['local file storage', { STORAGE_DRIVER: 'fs' }],
    ['example mail sender', { MAIL_FROM: 'WatchDog Support <support@watchdog.example>' }],
    ['mock identity', { IDENTITY_PROVISIONER: 'mock' }],
    ['no virus scanning', { AV_MODE: 'skip' }],
    ['AI mode without a key', { ASSISTANT_MODE: 'anthropic' }],
  ])('refuses %s', (_n, bad) => {
    expect(() => loadConfig({ ...prod, ...bad })).toThrow();
  });
});
