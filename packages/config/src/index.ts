import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Environment schema for the API and worker processes. Validated once at boot; the process exits on error. */
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  METRICS_PORT: z.coerce.number().int().default(9464),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  /** Application role (non-owner, subject to RLS). */
  DATABASE_URL: z.string().min(1),
  /** Owner role, used only by migrations and seeds. */
  DATABASE_OWNER_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  AUTH_ISSUER: z.string().url(),
  AUTH_AUDIENCE: z.string().default('wd-api'),
  AUTH_JWKS_URL: z.string().url().optional(),
  /** ACR values that count as multi-factor. Keycloak LoA mapping: "mfa" -> 2. */
  AUTH_MFA_ACR_VALUES: z.string().default('mfa,2'),
  AUTH_REQUIRE_MFA: bool.default(true),

  KEYCLOAK_ADMIN_URL: z.string().url().optional(),
  KEYCLOAK_REALM: z.string().default('watchdog'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().optional(),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  IDENTITY_PROVISIONER: z.enum(['keycloak', 'mock']).default('mock'),

  STORAGE_DRIVER: z.enum(['s3', 'fs']).default('fs'),
  STORAGE_FS_ROOT: z.string().default('./data/objects'),
  S3_ENDPOINT: z.string().optional(),
  /** Browser-reachable endpoint used only to sign download URLs (defaults to S3_ENDPOINT). */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  /** Create the buckets at start-up if missing (dev/on-prem convenience; off when IaC owns buckets). */
  S3_ENSURE_BUCKETS: bool.default(false),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  S3_BUCKET_QUARANTINE: z.string().default('wd-quarantine'),
  S3_BUCKET_ATTACHMENTS: z.string().default('wd-attachments'),
  UPLOAD_TMP_DIR: z.string().default('./data/uploads'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .default(2 * 1024 * 1024 * 1024),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(300),
  /** HMAC key for signed download URLs (fs driver), reply tokens and CSAT tokens. >= 32 chars. */
  APP_SIGNING_KEY: z.string().min(32),

  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  /** When ClamAV is not configured: 'fail-closed' keeps files quarantined; 'skip' is for local dev only. */
  AV_MODE: z.enum(['clamav', 'skip']).default('clamav'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('WatchDog Support <support@watchdog.example>'),
  /** Sales/renewals mailbox that receives renewal-quote requests (CRM adapter in Phase 4). */
  RENEWALS_EMAIL: z.string().email().default('renewals@watchdog.example'),
  /** Where customers send faulty units; printed on the RMA form. Set the real address before go-live. */
  RMA_RETURN_ADDRESS: z
    .string()
    .default('WatchDog Returns Centre, Apollo Infoways Pvt. Ltd., India (address not configured)'),
  MAIL_REPLY_DOMAIN: z.string().default('support.watchdog.example'),
  MAIL_REPLY_LOCALPART: z.string().default('case'),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().default(993),
  IMAP_USER: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  SMS_ADAPTER: z.enum(['mock']).default('mock'),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Environment schema for the Next.js BFF (server side only). */
export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  API_INTERNAL_URL: z.string().url().default('http://localhost:4000'),
  OIDC_ISSUER: z.string().url(),
  /** Browser-facing issuer if it differs from the in-cluster one (docker compose). */
  OIDC_PUBLIC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().default('wd-web'),
  OIDC_CLIENT_SECRET: z.string().min(1),
  SESSION_REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .default(8 * 3600),
  SESSION_COOKIE_SECURE: bool.default(true),
});
export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
