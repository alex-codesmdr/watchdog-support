import 'reflect-metadata';
import { createServer } from 'node:http';
import { collectDefaultMetrics, register } from 'prom-client';
import { createHttpApp } from './http.js';
import { logger } from './common/logger.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/database.js';
import { CONFIG, DB, OBJECT_STORE } from './tokens.js';
import { S3ObjectStore, type ObjectStore } from './modules/files/object-store.js';

async function bootstrap() {
  const app = await createHttpApp();
  const cfg = app.get<AppConfig>(CONFIG);
  await app.get<Database>(DB).assertSafeRole();
  const store = app.get<ObjectStore>(OBJECT_STORE);
  if (store instanceof S3ObjectStore && app.get<AppConfig>(CONFIG).S3_ENSURE_BUCKETS)
    await store.ensureBuckets();

  // Prometheus metrics on a separate, internal-only port.
  collectDefaultMetrics({ prefix: 'wd_api_' });
  createServer(async (req, res) => {
    if (req.url !== '/metrics') return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': register.contentType }).end(await register.metrics());
  }).listen(cfg.METRICS_PORT);

  await app.listen(cfg.API_PORT, '0.0.0.0');
  logger.info({ port: cfg.API_PORT }, 'WatchDog Support API listening');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
