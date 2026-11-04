import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/database.js';
import { CONFIG, DB, OBJECT_STORE } from '../../tokens.js';
import { CurrentPrincipal, Public } from '../../common/auth.js';
import { notFound, ProblemError } from '../../common/errors.js';
import type { Principal } from '../../common/principal.js';
import { asCase } from '@wd/rbac';
import { Signer } from '../../common/signing.js';
import {
  contentDisposition,
  FsObjectStore,
  type Bucket,
  type ObjectStore,
} from './object-store.js';

@Controller('api/v1')
export class FilesController {
  private readonly signer: Signer;
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {
    this.signer = new Signer(cfg.APP_SIGNING_KEY);
  }

  /** Mints a 5-minute download URL after an RLS-checked lookup. Only scanned-clean files. */
  @Get('attachments/:id/url')
  async url(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('Attachment');
    const row = await this.db.withTenant(p, (tx) =>
      tx
        .selectFrom('case_attachment as a')
        .innerJoin('support_case as c', 'c.id', 'a.case_id')
        .select(['a.object_key', 'a.file_name', 'a.scan_status', 'c.org_id', 'c.requester_id'])
        .where('a.id', '=', id)
        .executeTakeFirst(),
    );
    if (
      !row ||
      !p.ability.can('read', asCase({ orgId: row.org_id, requesterId: row.requester_id }))
    )
      throw notFound('Attachment');
    if (row.scan_status !== 'clean' || !row.object_key)
      throw new ProblemError(
        409,
        'not-ready',
        'This file is not available',
        row.scan_status === 'pending'
          ? 'Security scan in progress'
          : 'File failed the security scan',
      );
    const ttl = this.cfg.DOWNLOAD_URL_TTL_SECONDS;
    return {
      url: await this.store.signedDownloadUrl('attachments', row.object_key, row.file_name, ttl),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /** Signed-token download for the filesystem driver (S3 uses presigned URLs instead). */
  @Public()
  @Get('files/:token')
  async download(@Param('token') token: string, @Res() res: Response) {
    if (!(this.store instanceof FsObjectStore)) throw notFound('File');
    const t = this.signer.verify<{ b: Bucket; k: string; f: string }>(token);
    if (!t || t.b !== 'attachments') throw notFound('File');
    const stream = await this.store.get(t.b, t.k).catch(() => null);
    if (!stream) throw notFound('File');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(t.f));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }
}
