import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { apiEnvSchema } from '@wd/config';
import { createHttpApp } from '../src/http.js';
import { RateLimiters } from '../src/common/rate-limit.js';
import type { Database } from '../src/db/database.js';
import { MockProvisioner } from '../src/modules/identity/provisioner.js';
import { MemoryTransport, MockSmsAdapter } from '../src/modules/notifications/mailer.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { ScanService } from '../src/modules/files/scan.service.js';
import { DevAvScanner } from '../src/modules/files/clamav.js';
import {
  AV_SCANNER,
  DB,
  IDENTITY_PROVISIONER,
  JWKS,
  MAIL_TRANSPORT,
  RATE_LIMITER,
  REDIS,
  SMS_ADAPTER,
} from '../src/tokens.js';
import { OutboxRelay } from '../src/worker/outbox.js';

export const ISSUER = 'https://idp.test/realms/watchdog';

export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  mail: MemoryTransport;
  sms: MockSmsAdapter;
  idp: MockProvisioner;
  token(
    email: string,
    opts?: { acr?: string; emailVerified?: boolean; sub?: string },
  ): Promise<string>;
  as(email: string): Promise<{
    get: (u: string) => request.Test;
    post: (u: string, body?: unknown) => request.Test;
    put: (u: string, body?: unknown) => request.Test;
  }>;
  drainOutbox(): Promise<number>;
  owner: pg.Pool;
  app_: pg.Pool;
  close(): Promise<void>;
}

export async function createTestApp(opts: { rateLimitScale?: number } = {}): Promise<TestApp> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
  const config = apiEnvSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: 'wd-api',
    APP_SIGNING_KEY: 'test-signing-key-test-signing-key-0123456789',
    STORAGE_DRIVER: 'fs',
    STORAGE_FS_ROOT: mkdtempSync(join(tmpdir(), 'wd-objects-')),
    AV_MODE: 'skip',
    UPLOAD_MAX_BYTES: '10485760',
    PUBLIC_WEB_URL: 'https://support.watchdog.example',
    PUBLIC_API_URL: 'https://support.watchdog.example',
  });
  const mail = new MemoryTransport();
  const sms = new MockSmsAdapter();
  const idp = new MockProvisioner();
  const app = await createHttpApp({
    config,
    providers: [
      { provide: JWKS, useValue: createLocalJWKSet({ keys: [jwk] }) },
      { provide: REDIS, useValue: null },
      { provide: RATE_LIMITER, useValue: new RateLimiters(null, opts.rateLimitScale ?? 1) },
      { provide: MAIL_TRANSPORT, useValue: mail },
      { provide: SMS_ADAPTER, useValue: sms },
      { provide: IDENTITY_PROVISIONER, useValue: idp },
      { provide: AV_SCANNER, useValue: new DevAvScanner() },
    ],
  });
  await app.init();
  const db = app.get<Database>(DB);
  await db.assertSafeRole();
  const notifications = app.get(NotificationsService);
  const scan = app.get(ScanService);
  const relay = new OutboxRelay(db, {
    kind: 'inline',
    handler: async (topic, payload) => {
      if (topic === 'attachment.scan') await scan.process(String(payload.attachmentId));
      else await notifications.handle(topic, payload);
    },
  });

  const token = (email: string, o: { acr?: string; emailVerified?: boolean; sub?: string } = {}) =>
    new SignJWT({ email, email_verified: o.emailVerified ?? true, acr: o.acr ?? 'mfa' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(ISSUER)
      .setAudience('wd-api')
      .setSubject(o.sub ?? `kc-${email}`)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  const http = request(app.getHttpServer());
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
  const appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  return {
    app,
    http,
    mail,
    sms,
    idp,
    token,
    async as(email: string) {
      const t = await token(email);
      return {
        get: (u: string) => http.get(u).set('authorization', `Bearer ${t}`),
        post: (u: string, body?: unknown) =>
          http
            .post(u)
            .set('authorization', `Bearer ${t}`)
            .send(body as object),
        put: (u: string, body?: unknown) =>
          http
            .put(u)
            .set('authorization', `Bearer ${t}`)
            .send(body as object),
      };
    },
    async drainOutbox() {
      let total = 0;
      for (let i = 0; i < 10; i++) {
        const n = await relay.runOnce();
        total += n;
        if (!n) break;
      }
      return total;
    },
    owner,
    app_: appPool,
    async close() {
      await owner.end();
      await appPool.end();
      await app.close();
    },
  };
}

export const USERS = {
  kaveriAdmin: 'it.admin@kaveribank.example',
  kaveriUser: 'noc@kaveribank.example',
  narmadaAdmin: 'admin@narmadacity.example',
  narmadaUser: 'netops@narmadacity.example',
  partner: 'support@sahyadri-si.example',
  l1: 'asha.l1@watchdog.example',
  l2: 'vikram.l2@watchdog.example',
  l3: 'farah.l3@watchdog.example',
  manager: 'rohan.manager@watchdog.example',
  content: 'meera.content@watchdog.example',
  rma: 'arjun.rma@watchdog.example',
  sysadmin: 'neha.admin@watchdog.example',
} as const;

export const ORG = {
  kaveri: '00000000-0000-4000-8000-000000000201',
  narmada: '00000000-0000-4000-8000-000000000202',
};
export const SERIAL = {
  kaveriMissionCritical: 'WDSW5600A0001',
  kaveriPremium: 'WDFW3100B0002',
  kaveriExpired: 'WDSW3100D0004',
  narmadaPremium: 'WDRT8800E0005',
};

export const caseBody = (serial: string, extra: Record<string, unknown> = {}) => ({
  serialNumber: serial,
  severity: 'P2',
  category: 'software',
  subject: 'BGP sessions flap after upgrade',
  description: 'After upgrading, BGP neighbours flap every few minutes.',
  ...extra,
});

/** Executes SQL as the app role with an explicit tenant context (bypasses the API entirely). */
export async function asTenant<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  ctx: { org?: string; user?: string; internal?: boolean; delegated?: string[] },
  text: string,
  values: unknown[] = [],
) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (ctx.org)
      await c.query(
        `SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.is_internal', $3, true), set_config('app.delegated_orgs', $4, true)`,
        [ctx.org, ctx.user ?? '', String(ctx.internal ?? false), (ctx.delegated ?? []).join(',')],
      );
    const r = await c.query<T>(text, values);
    await c.query('ROLLBACK');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
