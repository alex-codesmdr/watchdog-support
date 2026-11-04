import { Inject, Injectable } from '@nestjs/common';
import { simpleParser, type AddressObject } from 'mailparser';
import { sql } from 'kysely';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/database.js';
import { CONFIG, DB, OBJECT_STORE } from '../../tokens.js';
import type { ObjectStore } from '../files/object-store.js';
import { randomBytes } from 'node:crypto';
import { logger } from '../../common/logger.js';
import { emit } from '../../common/outbox.js';
import { textToHtml } from '../../common/sanitize.js';
import { Signer } from '../../common/signing.js';
import { resumeAll } from '../cases/sla.js';
import { caseNumberFromSubject, findReplyToken, stripQuoted } from './parse.js';

const EMAIL_ATTACHMENT_MAX_COUNT = 10;
const EMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** Mail clients send all sorts of names; keep it printable, path-free and within limits. */
export function safeFileName(n: string | undefined): string {
  const base = [...(n ?? '').replace(/[\\/]/g, '_')]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim();
  return (base || 'attachment').slice(-200);
}

export type IngestResult =
  | { status: 'appended'; caseId: string; messageId: string }
  | { status: 'duplicate' }
  | { status: 'held'; reason: string };

/**
 * Email-to-case (ADR-015). Threads by signed reply token, then subject number; verifies the sender
 * belongs to the case's organisation (or a delegated partner). Anything doubtful is held for staff.
 * Only appends to existing cases — new cases must be opened in the portal (entitlement check).
 */
@Injectable()
export class EmailInService {
  private readonly signer: Signer;
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {
    this.signer = new Signer(cfg.APP_SIGNING_KEY);
  }

  async ingest(raw: Buffer | string): Promise<IngestResult> {
    const mail = await simpleParser(raw);
    const from = (mail.from?.value[0]?.address ?? '').toLowerCase();
    const messageId = mail.messageId ?? null;
    const recipients = [
      mail.to,
      mail.cc,
      mail.headers.get('delivered-to') as AddressObject | undefined,
    ]
      .flatMap((a) => (Array.isArray(a) ? a : a ? [a] : []))
      .flatMap((a) => (a as AddressObject).value?.map((v) => v.address ?? '') ?? []);

    const hold = (reason: string, caseId: string | null = null) =>
      this.db.withSystem(async (tx) => {
        await tx
          .insertInto('inbound_email_hold')
          .values({
            message_id: messageId,
            from_addr: from || 'unknown',
            subject: mail.subject ?? null,
            reason,
            case_id: caseId,
          })
          .execute();
        logger.warn({ reason, messageId }, 'inbound email held for review');
        return { status: 'held' as const, reason };
      });

    if (!from) return hold('missing-sender');
    // Auto-replies and bounces never create messages (prevents mail loops).
    const auto = String(mail.headers.get('auto-submitted') ?? 'no').toLowerCase();
    if (auto !== 'no' || /^(mailer-daemon|postmaster)@/i.test(from)) return hold('auto-generated');

    const token = findReplyToken(
      recipients,
      this.cfg.MAIL_REPLY_LOCALPART,
      this.cfg.MAIL_REPLY_DOMAIN,
    );
    const number = token ? this.signer.verifyReplyToken(token) : null;
    if (token && !number) return hold('invalid-reply-token');
    const caseNumber = number ?? caseNumberFromSubject(mail.subject);
    if (!caseNumber) return hold('no-case-reference');

    return this.db.withSystem(async (tx) => {
      if (messageId) {
        const dup = await tx
          .selectFrom('case_message')
          .select('id')
          .where('email_message_id', '=', messageId)
          .executeTakeFirst();
        if (dup) return { status: 'duplicate' as const };
      }
      const c = await tx
        .selectFrom('support_case')
        .select(['id', 'org_id', 'number', 'status'])
        .where('number', '=', caseNumber)
        .executeTakeFirst();
      if (!c) return hold('unknown-case');
      // Sender must be an active user of the case org, or of a partner with an active delegation.
      const sender = await sql<{ id: string }>`
        SELECT u.id FROM app_user u
        WHERE u.email = ${from} AND u.status = 'active' AND (
          u.org_id = ${c.org_id}
          OR u.org_id IN (SELECT partner_org_id FROM partner_delegation WHERE customer_org_id = ${c.org_id} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())))
        LIMIT 1`.execute(tx);
      const userId = sender.rows[0]?.id;
      // Subject-only matches (no signed token) are lower trust: require a known sender as well.
      if (!userId) return hold('unverified-sender', c.id);
      if (c.status === 'closed') return hold('case-closed', c.id);

      const text = stripQuoted(mail.text ?? '');
      if (!text) return hold('empty-body', c.id);
      const msg = await tx
        .insertInto('case_message')
        .values({
          case_id: c.id,
          author_id: userId,
          author_is_staff: false,
          visibility: 'public',
          body_html: textToHtml(text),
          source: 'email',
          email_message_id: messageId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Attachments go through the same quarantine → antivirus → secret-masking pipeline as portal
      // uploads. Inline images (signatures, logos) are ignored; oversized or excess files are noted.
      const files = mail.attachments.filter(
        (a) => !(a.contentDisposition === 'inline' && a.contentType.startsWith('image/')),
      );
      const maxBytes = Math.min(EMAIL_ATTACHMENT_MAX_BYTES, this.cfg.UPLOAD_MAX_BYTES);
      const accepted = files.filter((a) => a.size <= maxBytes).slice(0, EMAIL_ATTACHMENT_MAX_COUNT);
      for (const a of accepted) {
        const id = randomBytes(16).toString('hex');
        const name = safeFileName(a.filename);
        await this.store.put('quarantine', id, a.content);
        await tx
          .insertInto('upload')
          .values({
            id,
            org_id: c.org_id,
            user_id: userId,
            file_name: name,
            size_bytes: a.size,
            completed: true,
            bound_at: new Date(),
          })
          .execute();
        const att = await tx
          .insertInto('case_attachment')
          .values({
            case_id: c.id,
            message_id: msg.id,
            upload_id: id,
            file_name: name,
            size_bytes: a.size,
            quarantine_key: id,
            visibility: 'public',
            uploaded_by: userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await emit(tx, 'attachment.scan', null, { attachmentId: att.id });
      }
      if (files.length > accepted.length) {
        await tx
          .insertInto('case_event')
          .values({
            case_id: c.id,
            type: 'email_attachments_skipped',
            visibility: 'public',
            actor_id: userId,
            data: JSON.stringify({
              count: files.length - accepted.length,
              reason: `Email attachments are limited to ${EMAIL_ATTACHMENT_MAX_COUNT} files of up to ${Math.round(maxBytes / 1_048_576)} MB each. Upload larger files in the portal.`,
            }),
          } as never)
          .execute();
      }
      if (c.status === 'awaiting_customer') {
        // Same effect as a portal reply: back to the engineer, clocks resume.
        await resumeAll(tx, c.id, new Date());
        await tx
          .updateTable('support_case')
          .set({ status: 'in_progress', version: sql`version + 1` })
          .where('id', '=', c.id)
          .execute();
        await tx
          .insertInto('case_event')
          .values({
            case_id: c.id,
            type: 'status_changed',
            actor_id: userId,
            data: JSON.stringify({ from: 'awaiting_customer', to: 'in_progress', auto: true }),
          } as never)
          .execute();
      }
      await emit(tx, 'case.message.public_created', c.org_id, {
        caseId: c.id,
        number: c.number,
        messageId: msg.id,
        byStaff: false,
      });
      return { status: 'appended' as const, caseId: c.id, messageId: msg.id };
    });
  }
}
