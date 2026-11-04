import { createHash } from 'node:crypto';
import { type Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { Database } from '../../db/database.js';
import { AV_SCANNER, DB, OBJECT_STORE } from '../../tokens.js';
import { logger } from '../../common/logger.js';
import type { AvScanner } from './clamav.js';
import type { ObjectStore } from './object-store.js';
import { isTextLike, maskSecrets } from './secret-masker.js';

const MAX_IN_MEMORY = 64 * 1024 * 1024; // text files up to this size are masked in memory; larger ones are scanned but flagged unmasked
const EXECUTABLE_MIME = new Set([
  'application/x-msdownload',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-msi',
  'application/vnd.microsoft.portable-executable',
  'application/x-sharedlib',
  'application/java-archive',
]);

/**
 * Quarantine → (magic-byte check, antivirus, secret masking) → attachments bucket.
 * Runs in the worker under system context. Idempotent: only acts on `pending` rows.
 */
@Injectable()
export class ScanService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(AV_SCANNER) private readonly av: AvScanner,
  ) {}

  async process(
    attachmentId: string,
  ): Promise<'clean' | 'infected' | 'rejected' | 'error' | 'skipped'> {
    const att = await this.db.withSystem((tx) =>
      tx
        .selectFrom('case_attachment')
        .selectAll()
        .where('id', '=', attachmentId)
        .where('scan_status', '=', 'pending')
        .executeTakeFirst(),
    );
    if (!att) return 'skipped';
    const finish = (set: Record<string, unknown>) =>
      this.db.withSystem((tx) =>
        tx
          .updateTable('case_attachment')
          .set(set)
          .where('id', '=', att.id)
          .where('scan_status', '=', 'pending')
          .execute(),
      );

    try {
      const q = att.quarantine_key;
      const head = await readHead(await this.store.get('quarantine', q), 4100);
      const sniff = await fileTypeFromBuffer(head);
      const looksExecutable =
        (sniff && EXECUTABLE_MIME.has(sniff.mime)) ||
        head.subarray(0, 2).toString('latin1') === 'MZ' ||
        head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
      if (looksExecutable) {
        await finish({
          scan_status: 'rejected',
          scan_detail: 'executable content is not accepted',
        });
        await this.store.delete('quarantine', q);
        return 'rejected';
      }

      // Full-length AV scan with the SHA-256 computed in the same pass.
      const hash = createHash('sha256');
      const src = await this.store.get('quarantine', q);
      src.on('data', (c: Buffer) => hash.update(c));
      const av = await this.av.scan(src);
      const sha256 = hash.digest('hex');
      if (!av.clean) {
        await finish({
          scan_status: 'infected',
          scan_detail: av.signature ?? 'malware detected',
          sha256,
        });
        await this.store.delete('quarantine', q);
        logger.warn(
          { attachmentId, signature: av.signature },
          'infected upload quarantined and removed',
        );
        return 'infected';
      }

      const objectKey = `org/${att.org_id}/case/${att.case_id}/${att.id}`;
      let masked = 0;
      let originalKey: string | null = null;
      const size = Number(att.size_bytes);
      if (size <= MAX_IN_MEMORY && isTextLike(att.file_name, head)) {
        const body = await streamToBuffer(await this.store.get('quarantine', q));
        const r = maskSecrets(body.toString('utf8'));
        if (r.count > 0) {
          masked = r.count;
          originalKey = `${objectKey}.original`;
          // Unmasked original kept server-side-encrypted; access is an L3-only, audited action (Phase 4 UI).
          await this.store.put('attachments', originalKey, body);
          await this.store.put('attachments', objectKey, Buffer.from(r.text, 'utf8'));
        } else {
          await this.store.put('attachments', objectKey, body);
        }
      } else {
        await this.store.put('attachments', objectKey, await this.store.get('quarantine', q));
      }
      await finish({
        scan_status: 'clean',
        sha256,
        object_key: objectKey,
        original_key: originalKey,
        secrets_masked: masked > 0,
        masked_count: masked,
        content_type: sniff?.mime ?? null,
      });
      await this.store.delete('quarantine', q).catch(() => undefined);
      return 'clean';
    } catch (err) {
      // Fail closed: the file stays quarantined and `pending`; the job is retried with backoff.
      logger.error({ err, attachmentId }, 'attachment scan failed; file stays quarantined');
      await finish({ scan_detail: `scan attempt failed at ${new Date().toISOString()}` }).catch(
        () => undefined,
      );
      return 'error';
    }
  }
}

async function streamToBuffer(s: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

async function readHead(s: Readable, n: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let got = 0;
  for await (const c of s) {
    parts.push(c as Buffer);
    got += (c as Buffer).length;
    if (got >= n) break;
  }
  s.destroy();
  return Buffer.concat(parts).subarray(0, n);
}
