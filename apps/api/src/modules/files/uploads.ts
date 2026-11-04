import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { FileStore } from '@tus/file-store';
import { S3Store } from '@tus/s3-store';
import { Server, type Upload } from '@tus/server';
import type { Request, Response } from 'express';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/database.js';
import { CONFIG, DB } from '../../tokens.js';
import { forbidden, notFound, ProblemError, unprocessable } from '../../common/errors.js';
import type { Principal } from '../../common/principal.js';
import { has } from '../../common/principal.js';

export const ALLOWED_EXTENSIONS = [
  'txt', 'log', 'cfg', 'conf', 'config', 'diag', 'out', 'csv', 'json', 'xml', 'yaml', 'yml', 'har',
  'pcap', 'pcapng', 'cap', 'zip', 'gz', 'tgz', 'tar', '7z', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'bin', 'dat',
];
export const CHUNK_BYTES = 8 * 1024 * 1024;

const als = new AsyncLocalStorage<{ principal: Principal; id: string }>();

export function safeFileName(raw: string | null | undefined): string {
  const name = (raw ?? '').normalize('NFC').replace(/[\\/\0-\x1f\x7f]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);
  if (!name) throw unprocessable('invalid-filename', 'File name is missing');
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.includes(ext))
    throw unprocessable('file-type', 'This file type is not accepted', `Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  return name;
}

/**
 * Resumable uploads (tus 1.0). Every request is authenticated by the global guard; creation records
 * an `upload` row owned by the caller (RLS), and PATCH/HEAD are only served for the caller's own uploads.
 * Bytes land in QUARANTINE and are never served until the scan pipeline promotes them.
 */
@Controller('api/v1/uploads')
export class UploadsController {
  private readonly tus: Server;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig, @Inject(DB) private readonly db: Database) {
    const datastore =
      cfg.STORAGE_DRIVER === 's3'
        ? new S3Store({
            partSize: CHUNK_BYTES,
            s3ClientConfig: {
              bucket: cfg.S3_BUCKET_QUARANTINE,
              region: cfg.S3_REGION,
              endpoint: cfg.S3_ENDPOINT,
              forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
              credentials: { accessKeyId: cfg.S3_ACCESS_KEY ?? '', secretAccessKey: cfg.S3_SECRET_KEY ?? '' },
            },
          })
        : new FileStore({ directory: ensureDir(join(resolve(cfg.STORAGE_FS_ROOT), 'quarantine')) });

    this.tus = new Server({
      path: '/api/v1/uploads',
      datastore,
      maxSize: cfg.UPLOAD_MAX_BYTES,
      respectForwardedHeaders: false,
      // Relative Location so it works behind the web BFF proxy as well.
      generateUrl: (_req, { path, id }) => `${path}/${id}`,
      namingFunction: () => {
        const s = als.getStore();
        if (!s) throw new Error('upload context missing');
        return s.id;
      },
      onUploadCreate: async (_req, upload: Upload) => {
        const s = als.getStore();
        if (!s) throw { status_code: 403, body: 'Forbidden' };
        let fileName: string;
        try {
          fileName = safeFileName(upload.metadata?.filename);
        } catch {
          throw { status_code: 415, body: 'File type not accepted' };
        }
        await this.db.withTenant(s.principal, (tx) =>
          tx.insertInto('upload').values({ id: s.id, org_id: s.principal.orgId, user_id: s.principal.userId, file_name: fileName, size_bytes: upload.size ?? 0 }).execute(),
        );
        return { metadata: { ...upload.metadata, filename: fileName } };
      },
      onUploadFinish: async (_req, upload: Upload) => {
        const s = als.getStore();
        if (s) {
          await this.db.withTenant(s.principal, (tx) =>
            tx.updateTable('upload').set({ completed: true, size_bytes: upload.offset }).where('id', '=', upload.id).execute(),
          );
        }
        return {};
      },
    });
  }

  @All()
  async create(@Req() req: Request, @Res() res: Response) {
    const p = this.principalFor(req);
    if (req.method === 'POST') {
      const len = Number(req.headers['upload-length'] ?? 'NaN');
      if (!Number.isFinite(len) || len < 0) throw new ProblemError(400, 'upload-length', 'Upload-Length header is required');
      if (len > this.cfg.UPLOAD_MAX_BYTES) throw new ProblemError(413, 'too-large', 'File is larger than the allowed limit');
    }
    const id = randomBytes(16).toString('hex');
    await als.run({ principal: p, id }, () => this.tus.handle(req, res));
  }

  @All(':id')
  async resume(@Req() req: Request, @Res() res: Response) {
    const p = this.principalFor(req);
    const id = String(req.params.id ?? '');
    if (!/^[a-f0-9]{32}$/.test(id)) throw notFound('Upload');
    const own = await this.db.withTenant(p, (tx) => tx.selectFrom('upload').select(['id', 'bound_at']).where('id', '=', id).executeTakeFirst());
    if (!own) throw notFound('Upload');
    if (own.bound_at && req.method !== 'HEAD') throw new ProblemError(409, 'upload-bound', 'Upload is already attached');
    await als.run({ principal: p, id }, () => this.tus.handle(req, res));
  }

  private principalFor(req: Request): Principal {
    const p = req.wd?.principal;
    if (!p) throw new ProblemError(401, 'unauthorized', 'Authentication required');
    if (!has(p, 'attachment:upload')) throw forbidden();
    return p;
  }
}

function ensureDir(d: string) {
  mkdirSync(d, { recursive: true });
  return d;
}
