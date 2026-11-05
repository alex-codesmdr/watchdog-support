import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { Redis } from 'ioredis';
import { loadConfig, type AppConfig } from './config.js';
import { Database } from './db/database.js';
import { AuthGuard, PermissionGuard } from './common/auth.js';
import { RateLimitGuard, RateLimiters } from './common/rate-limit.js';
import { Signer } from './common/signing.js';
import {
  AV_SCANNER,
  CONFIG,
  DB,
  IDENTITY_PROVISIONER,
  JWKS,
  MAIL_TRANSPORT,
  OBJECT_STORE,
  RATE_LIMITER,
  REDIS,
  SMS_ADAPTER,
} from './tokens.js';
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
import { SlaMonitorService } from './modules/sla/sla-monitor.service.js';
import { SlaReportController } from './modules/sla/sla-report.controller.js';
import { WarrantyController } from './modules/public/warranty.controller.js';
import { KbController, KbEditorController } from './modules/kb/kb.controller.js';
import { KbService } from './modules/kb/kb.service.js';
import { SitesController } from './modules/assets/sites.controller.js';
import { AssetImportController } from './modules/assets/asset-import.controller.js';
import { RemindersService } from './modules/assets/reminders.service.js';
import {
  DownloadsController,
  ReleasesAdminController,
} from './modules/downloads/downloads.controller.js';
import { DownloadsService } from './modules/downloads/downloads.service.js';
import { RmaController } from './modules/rma/rma.controller.js';
import { AdvisoriesController } from './modules/advisories/advisories.controller.js';
import { AuditController } from './modules/audit/audit.controller.js';
import { AnnouncementsController } from './modules/announcements/announcements.controller.js';
import { SavedRepliesController } from './modules/saved-replies/saved-replies.controller.js';
import { TeamController } from './modules/identity/team.controller.js';
import { OpsReportController } from './modules/reports/ops-report.controller.js';
import { IntegrationsController } from './modules/integrations/integrations.controller.js';
import { WebhooksService } from './modules/integrations/webhooks.service.js';
import { AdvisoriesService } from './modules/advisories/advisories.service.js';
import { RmaService } from './modules/rma/rma.service.js';

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
      {
        provide: REDIS,
        useFactory: () =>
          new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
      },
      {
        provide: RATE_LIMITER,
        useFactory: (r: Redis | null) => new RateLimiters(r),
        inject: [REDIS],
      },
      {
        provide: JWKS,
        useFactory: () =>
          createRemoteJWKSet(
            new URL(cfg.AUTH_JWKS_URL ?? `${cfg.AUTH_ISSUER}/protocol/openid-connect/certs`),
            { cooldownDuration: 30_000, cacheMaxAge: 600_000 },
          ),
      },
      {
        provide: OBJECT_STORE,
        useFactory: () =>
          cfg.STORAGE_DRIVER === 's3'
            ? new S3ObjectStore(cfg)
            : new FsObjectStore(
                cfg.STORAGE_FS_ROOT,
                new Signer(cfg.APP_SIGNING_KEY),
                cfg.PUBLIC_API_URL,
              ),
      },
      { provide: MAIL_TRANSPORT, useFactory: () => new SmtpTransport(cfg) },
      { provide: SMS_ADAPTER, useFactory: () => new MockSmsAdapter() },
      {
        provide: IDENTITY_PROVISIONER,
        useFactory: () =>
          cfg.IDENTITY_PROVISIONER === 'keycloak'
            ? new KeycloakProvisioner(cfg)
            : new MockProvisioner(),
      },
      {
        provide: AV_SCANNER,
        useFactory: () =>
          cfg.AV_MODE === 'clamav' && cfg.CLAMAV_HOST
            ? new ClamAvScanner(cfg.CLAMAV_HOST, cfg.CLAMAV_PORT)
            : new DevAvScanner(),
      },
    ];
    const overridden = new Set((o.providers ?? []).map((p) => (p as { provide: unknown }).provide));
    return {
      module: AppModule,
      controllers: [
        HealthController,
        IdentityController,
        CatalogController,
        AssetsController,
        CasesController,
        PublicCsatController,
        UploadsController,
        FilesController,
        DevController,
        SlaReportController,
        WarrantyController,
        KbController,
        KbEditorController,
        SitesController,
        AssetImportController,
        DownloadsController,
        ReleasesAdminController,
        RmaController,
        AdvisoriesController,
        IntegrationsController,
        OpsReportController,
        AuditController,
        AnnouncementsController,
        SavedRepliesController,
        TeamController,
      ],
      providers: [
        ...defaults.filter((p) => !overridden.has((p as { provide: unknown }).provide)),
        ...(o.providers ?? []),
        CasesService,
        ScanService,
        NotificationsService,
        EmailInService,
        SlaMonitorService,
        KbService,
        RemindersService,
        DownloadsService,
        RmaService,
        AdvisoriesService,
        WebhooksService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
