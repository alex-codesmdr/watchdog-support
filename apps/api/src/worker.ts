import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { logger } from './common/logger.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/database.js';
import { EmailInService } from './modules/email-in/email-in.service.js';
import { ImapPoller } from './modules/email-in/imap-poller.js';
import { ScanService } from './modules/files/scan.service.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { CONFIG, DB } from './tokens.js';
import { OutboxRelay, startConsumers } from './worker/outbox.js';

async function bootstrap() {
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(), { logger: ['error', 'warn'] });
  const cfg = ctx.get<AppConfig>(CONFIG);
  const db = ctx.get<Database>(DB);
  await db.assertSafeRole();
  const connection = { url: cfg.REDIS_URL, maxRetriesPerRequest: null };

  const notifications = ctx.get(NotificationsService);
  const scan = ctx.get(ScanService);
  const relay = new OutboxRelay(db, { kind: 'bullmq', connection });
  const workers = startConsumers(connection, {
    notifications: (topic, payload) => notifications.handle(topic, payload),
    'file-scan': async (_topic, payload) => {
      const r = await scan.process(String(payload.attachmentId));
      if (r === 'error') throw new Error('scan failed; will retry');
    },
  });
  relay.start();
  const imap = new ImapPoller(cfg, ctx.get(EmailInService));
  imap.start();
  logger.info('WatchDog Support worker started');

  const shutdown = async () => {
    logger.info('worker shutting down');
    imap.stop();
    await relay.stop();
    await Promise.all(workers.map((w) => w.close()));
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
