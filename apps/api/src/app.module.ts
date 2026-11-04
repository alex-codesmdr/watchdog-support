import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { Redis } from 'ioredis';
import { loadConfig, type AppConfig } from './config.js';
import { Database } from './db/database.js';
import { AuthGuard, PermissionGuard } from './common/auth.js';
import { RateLimitGuard, RateLimiters } from './common/rate-limit.js';
import { Signer } from './common/signing.js';
import { AV_SCANNER, CONFIG, DB, IDENTITY_PROVISIONER, JWKS, MAIL_TRANSPORT, OBJECT_STORE, RATE_LIMITER, REDIS, SMS_ADAPTER } from './tokens.js';
import { AssetsController } from './modules/assets/assets.controller.js';
import { CasesController, PublicCsatController } from './modules/cases/cases.controller.js';
import { CasesService } from './modules/cases/cases.service.js';
import { CatalogController } from './modules/catalog/catalog.controller.js';
import { DevController } from './modules/dev.controller.js';
import { EmailInService } from './modules/email-in/email-in.service.js';
import { ClamAvScanner, DevAvScanner } from './modules/files/clamav.js';
import { FilesController } from './modules/files/files.controller.js';
import { FsObjectStore, S3ObjectStore } from './modules/files/object-store.js';
import { ScanService } from './modules/files/scan.service.js';
import { UploadsController } from './modules/files/uploads.js';
import { HealthController } from './modules/health.controller.js';
import { IdentityController } from './modules/identity/identity.controller.js';
import { KeycloakProvisioner, MockProvisioner } from './modules/identity/provisioner.js';
import { MockSmsAdapter, SmtpTransport } from './modules/notifications/mailer.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';

/** Providers tests may replace (JWKS, transports, storage, AV, IdP, Redis). */
export interface AppOverrides {
  config?: AppConfig;
  providers?: Provider[];
}

@Module({})
export class AppModule {
  static forRoot(o: AppOverrides = {}): DynamicModule {
    const cfg = o.config ?? loadConfig();
    const defaults: Provider[] = [
      { provide: CONFIG, useValue: cfg },
      { provide: DB, useFactory: () => new Database(cfg.DATABASE_URL) },
      { provide: REDIS, useFactory: () => new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }) },
      { provide: RATE_LIMITER, useFactory: (r: Redis | null) => new RateLimiters(r), inject: [REDIS] },
      { provide: JWKS, useFactory: () => createRemoteJWKSet(new URL(cfg.AUTH_JWKS_URL ?? `${cfg.AUTH_ISSUER}/protocol/openid-connect/certs`), { cooldownDuration: 30_000, cacheMaxAge: 600_000 }) },
      {
        provide: OBJECT_STORE,
        useFactory: () => (cfg.STORAGE_DRIVER === 's3' ? new S3ObjectStore(cfg) : new FsObjectStore(cfg.STORAGE_FS_ROOT, new Signer(cfg.APP_SIGNING_KEY), cfg.PUBLIC_API_URL)),
      },
      { provide: MAIL_TRANSPORT, useFactory: () => new SmtpTransport(cfg) },
      { provide: SMS_ADAPTER, useFactory: () => new MockSmsAdapter() },
      { provide: IDENTITY_PROVISIONER, useFactory: () => (cfg.IDENTITY_PROVISIONER === 'keycloak' ? new KeycloakProvisioner(cfg) : new MockProvisioner()) },
      { provide: AV_SCANNER, useFactory: () => (cfg.AV_MODE === 'clamav' && cfg.CLAMAV_HOST ? new ClamAvScanner(cfg.CLAMAV_HOST, cfg.CLAMAV_PORT) : new DevAvScanner()) },
    ];
    const overridden = new Set((o.providers ?? []).map((p) => (p as { provide: unknown }).provide));
    return {
      module: AppModule,
      controllers: [HealthController, IdentityController, CatalogController, AssetsController, CasesController, PublicCsatController, UploadsController, FilesController, DevController],
      providers: [
        ...defaults.filter((p) => !overridden.has((p as { provide: unknown }).provide)),
        ...(o.providers ?? []),
        CasesService,
        ScanService,
        NotificationsService,
        EmailInService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
