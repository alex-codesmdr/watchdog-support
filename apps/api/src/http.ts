import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { AppModule, type AppOverrides } from './app.module.js';
import { ProblemFilter } from './common/problem.filter.js';
import { logger } from './common/logger.js';
import type { AppConfig } from './config.js';
import { CONFIG } from './tokens.js';
import { buildOpenApi } from './openapi/document.js';

/** Builds the HTTP app (shared by main.ts and the integration tests). */
export async function createHttpApp(o: AppOverrides = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(o), {
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  const cfg = app.get<AppConfig>(CONFIG);
  app.set('trust proxy', cfg.NODE_ENV === 'production' ? 1 : 'loopback');
  app.set('x-powered-by', false);

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: cfg.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const rid = String(req.headers['x-request-id'] ?? '');
    req.wd = {
      requestId: /^[A-Za-z0-9-]{8,64}$/.test(rid) ? rid : randomUUID(),
      ip: req.ip ?? null,
    };
    next();
  });
  if (cfg.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        serializers: {
          req: (r: { id: string; method: string; url: string }) => ({
            id: r.id,
            method: r.method,
            url: r.url.split('?')[0],
          }),
          res: (r: { statusCode: number }) => ({ statusCode: r.statusCode }),
        },
        genReqId: (req) => (req as Request).wd!.requestId,
        customProps: (req) => ({
          orgId: (req as Request).wd?.principal?.orgId,
          userId: (req as Request).wd?.principal?.userId,
        }),
      }),
    );
  }
  // JSON for the API; raw RFC 822 only for the dev inbound-email simulator. tus handles its own bodies.
  app.use(
    '/api/v1/dev/inbound-email',
    express.text({ type: ['text/plain', 'message/rfc822'], limit: '10mb' }),
  );
  // Device import: CSV or Excel uploaded as the raw request body (staff only; size-capped).
  app.use(
    '/api/v1/admin/asset-imports',
    express.raw({
      type: [
        'text/csv',
        'application/csv',
        'application/octet-stream',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      limit: '5mb',
    }),
  );
  app.use(express.json({ limit: '1mb', type: ['application/json', 'application/*+json'] }));

  // API docs: public in non-production; behind the internal ingress in production.
  const doc = buildOpenApi(cfg.PUBLIC_API_URL);
  app.use('/api/openapi.json', (_req: Request, res: Response) => void res.json(doc));
  if (cfg.NODE_ENV !== 'production') {
    app.use(
      '/api/docs',
      (_req: Request, res: Response, next: NextFunction) => {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'",
        );
        next();
      },
      swaggerUi.serve,
      swaggerUi.setup(doc, { customSiteTitle: 'WatchDog Support API' }),
    );
  }
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  return app;
}
