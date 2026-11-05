import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { WEBHOOK_EVENTS, type WebhookEvent, type WebhookView } from '@wd/contracts';
import type { AppConfig } from '../../config.js';
import type { Database, Tx } from '../../db/database.js';
import { CONFIG, DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { forbidden, notFound, unprocessable } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { randomString, SecretBox } from '../../common/secrets.js';
import { checkWebhookUrl, UnsafeUrlError } from '../../common/ssrf.js';

const ymd = (d: Date | string) =>
  d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);

/** Internal outbox topic → public webhook event name. */
export const WEBHOOK_TOPICS: Record<string, WebhookEvent> = {
  'case.created': 'case.created',
  'case.status_changed': 'case.status_changed',
  'case.message.public_created': 'case.message.public_created',
  'sla.breached': 'sla.breached',
  'rma.status_changed': 'rma.status_changed',
  'advisory.published': 'advisory.published',
  'coverage.expiring': 'entitlement.expiring',
};
const MAX_ATTEMPTS = 8;
/** Retry after 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h. */
const BACKOFF_S = [60, 300, 900, 3600, 10_800, 21_600, 43_200];
/** Consecutive deliveries that exhausted their retries before the webhook is switched off. */
const DISABLE_AFTER = 5;

export interface EventMeta {
  eventId: string;
  orgId: string | null;
}

/** HMAC signature header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. */
export function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/**
 * Signed webhooks for customer systems (ADR-014, threat T9). Event bodies carry only identifiers and
 * public facts (never internal notes, engineer names or vendor mappings); receivers fetch details
 * through the API with their key.
 */
@Injectable()
export class WebhooksService {
  private readonly box: SecretBox;
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {
    this.box = new SecretBox(cfg.APP_SIGNING_KEY, 'webhook-secret');
  }

  // ------------------------------------------------------------------ management (customer admin)

  private own(p: Principal) {
    if (p.isInternal) throw forbidden('Webhooks are managed by the customer organisation');
  }

  async list(p: Principal): Promise<{ items: WebhookView[] }> {
    this.own(p);
    return this.db.withTenant(p, async (tx) => {
      const hooks = await tx
        .selectFrom('webhook')
        .select(['id', 'url', 'events', 'active', 'disabled_reason', 'created_at'])
        .where('org_id', '=', p.orgId)
        .orderBy('created_at')
        .execute();
      const recent = hooks.length
        ? await tx
            .selectFrom('webhook_delivery')
            .select([
              'id',
              'webhook_id',
              'event_type',
              'status',
              'attempts',
              'last_status',
              'last_error',
              'created_at',
            ])
            .where(
              'webhook_id',
              'in',
              hooks.map((h) => h.id),
            )
            .orderBy('created_at', 'desc')
            .limit(20 * hooks.length)
            .execute()
        : [];
      return {
        items: hooks.map((h) => ({
          id: h.id,
          url: h.url,
          events: h.events as WebhookEvent[],
          active: h.active,
          disabledReason: h.disabled_reason,
          createdAt: h.created_at.toISOString(),
          recent: recent
            .filter((d) => d.webhook_id === h.id)
            .slice(0, 20)
            .map((d) => ({
              id: d.id,
              eventType: d.event_type,
              status: d.status,
              attempts: d.attempts,
              lastStatus: d.last_status,
              lastError: d.last_error,
              createdAt: d.created_at.toISOString(),
            })),
        })),
      };
    });
  }

  async create(p: Principal, ctx: RequestContext, url: string, events: WebhookEvent[]) {
    this.own(p);
    try {
      await checkWebhookUrl(url, this.cfg.WEBHOOK_ALLOW_PRIVATE_TARGETS);
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw unprocessable('url', e.message);
      throw e;
    }
    const secret = `whsec_${randomString(40)}`;
    const id = await this.db.withTenant(p, async (tx) => {
      const n = await tx
        .selectFrom('webhook')
        .select(sql<string>`count(*)`.as('n'))
        .where('org_id', '=', p.orgId)
        .executeTakeFirst();
      if (Number(n?.n) >= 10)
        throw unprocessable('url', 'An organisation can have at most 10 webhooks');
      const w = await tx
        .insertInto('webhook')
        .values({
          org_id: p.orgId,
          url,
          events: [...new Set(events)],
          secret_enc: this.box.seal(secret),
          created_by: p.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'webhook.create',
          orgId: p.orgId,
          targetType: 'webhook',
          targetId: w.id,
          diff: { url, events },
        },
      );
      return w.id;
    });
    // The signing secret is shown once; afterwards only a rotation produces a new one.
    return { id, secret };
  }

  async rotate(p: Principal, ctx: RequestContext, id: string) {
    this.own(p);
    const secret = `whsec_${randomString(40)}`;
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('webhook')
        .set({ secret_enc: this.box.seal(secret) })
        .where('id', '=', id)
        .where('org_id', '=', p.orgId)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Webhook');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'webhook.rotate', orgId: p.orgId, targetType: 'webhook', targetId: id },
      );
    });
    return { id, secret };
  }

  async setActive(p: Principal, ctx: RequestContext, id: string, active: boolean) {
    this.own(p);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('webhook')
        .set({ active, ...(active ? { disabled_reason: null, consecutive_failures: 0 } : {}) })
        .where('id', '=', id)
        .where('org_id', '=', p.orgId)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Webhook');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: active ? 'webhook.enable' : 'webhook.disable',
          orgId: p.orgId,
          targetType: 'webhook',
          targetId: id,
        },
      );
    });
  }

  async remove(p: Principal, ctx: RequestContext, id: string) {
    this.own(p);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .deleteFrom('webhook')
        .where('id', '=', id)
        .where('org_id', '=', p.orgId)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Webhook');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'webhook.delete', orgId: p.orgId, targetType: 'webhook', targetId: id },
      );
    });
  }

  /** Sends a `webhook.test` event straight away and returns the outcome. */
  async test(p: Principal, id: string) {
    this.own(p);
    const hook = await this.db.withTenant(p, (tx) =>
      tx
        .selectFrom('webhook')
        .select(['id', 'url', 'secret_enc'])
        .where('id', '=', id)
        .where('org_id', '=', p.orgId)
        .executeTakeFirst(),
    );
    if (!hook) throw notFound('Webhook');
    const body = JSON.stringify({
      id: randomUUID(),
      type: 'webhook.test',
      createdAt: new Date().toISOString(),
      data: { message: 'Test delivery from WatchDog Support' },
    });
    return this.post(hook.url, this.box.open(hook.secret_enc), 'webhook.test', randomUUID(), body);
  }

  // ------------------------------------------------------------------ fan-out (worker)

  /** Builds the public event body for an outbox event, or null if the event has no subject anymore. */
  private async eventData(tx: Tx, topic: string, payload: Record<string, unknown>) {
    const caseView = async (caseId: string) => {
      const c = await tx
        .selectFrom('support_case')
        .select(['number', 'subject', 'severity', 'status', 'org_id'])
        .where('id', '=', caseId)
        .executeTakeFirst();
      return (
        c && {
          orgId: c.org_id,
          data: {
            number: c.number,
            subject: c.subject,
            severity: c.severity,
            status: c.status,
            url: `${this.cfg.PUBLIC_WEB_URL}/portal/cases/${c.number}`,
          },
        }
      );
    };
    switch (topic) {
      case 'case.created':
      case 'case.status_changed':
        return caseView(String(payload.caseId));
      case 'case.message.public_created': {
        const v = await caseView(String(payload.caseId));
        return (
          v && { orgId: v.orgId, data: { case: v.data, messageId: payload.messageId ?? null } }
        );
      }
      case 'sla.breached': {
        const v = await caseView(String(payload.caseId));
        return v && { orgId: v.orgId, data: { case: v.data, metric: payload.metric } };
      }
      case 'rma.status_changed': {
        const r = await tx
          .selectFrom('rma as r')
          .innerJoin('support_case as c', 'c.id', 'r.case_id')
          .innerJoin('asset as a', 'a.id', 'r.asset_id')
          .select([
            'r.number',
            'r.status',
            'r.type',
            'r.org_id',
            'r.replacement_serial',
            'r.outbound_tracking',
            'c.number as case_number',
            'a.serial_number',
          ])
          .where('r.id', '=', String(payload.rmaId))
          .executeTakeFirst();
        return (
          r && {
            orgId: r.org_id,
            data: {
              number: r.number,
              status: r.status,
              previousStatus: payload.from ?? null,
              type: r.type,
              caseNumber: r.case_number,
              serialNumber: r.serial_number,
              replacementSerial: r.replacement_serial,
              trackingNumber: r.outbound_tracking,
            },
          }
        );
      }
      case 'advisory.published': {
        const a = await tx
          .selectFrom('advisory')
          .select(['wd_id', 'title', 'severity', 'cvss_score', 'cve_ids', 'revision', 'status'])
          .where('id', '=', String(payload.advisoryId))
          .executeTakeFirst();
        if (!a || a.status !== 'published') return null;
        return {
          orgId: null, // every subscribed organisation
          data: {
            id: a.wd_id,
            title: a.title,
            severity: a.severity,
            cvssScore: a.cvss_score === null ? null : Number(a.cvss_score),
            cveIds: a.cve_ids,
            revision: a.revision,
            url: `${this.cfg.PUBLIC_WEB_URL}/advisories/${a.wd_id}`,
          },
        };
      }
      case 'coverage.expiring': {
        const rows = await tx
          .selectFrom('entitlement as e')
          .innerJoin('asset as a', 'a.id', 'e.asset_id')
          .select(['a.serial_number', 'e.kind', 'e.tier', 'e.ends_on'])
          .where('e.id', 'in', (payload.entitlementIds as string[]) ?? [])
          .execute();
        return {
          orgId: String(payload.orgId),
          data: {
            daysBefore: payload.days,
            devices: rows.map((r) => ({
              serialNumber: r.serial_number,
              kind: r.kind,
              tier: r.tier,
              endsOn: ymd(r.ends_on as unknown as Date | string),
            })),
          },
        };
      }
      default:
        return null;
    }
  }

  /** Creates one delivery per matching active webhook, then attempts them. Idempotent per event. */
  async fanOut(topic: string, payload: Record<string, unknown>, meta: EventMeta): Promise<number> {
    const type = WEBHOOK_TOPICS[topic];
    if (!type) return 0;
    const ids = await this.db.withSystem(async (tx) => {
      const ev = await this.eventData(tx, topic, payload);
      if (!ev) return [];
      let q = tx
        .selectFrom('webhook')
        .select(['id', 'org_id'])
        .where('active', '=', true)
        .where(sql<boolean>`${type} = ANY(events)`);
      if (ev.orgId) q = q.where('org_id', '=', ev.orgId);
      const hooks = await q.execute();
      const out: string[] = [];
      for (const h of hooks) {
        const deliveryId = randomUUID();
        const body = JSON.stringify({
          id: meta.eventId,
          type,
          createdAt: new Date().toISOString(),
          data: ev.data,
        });
        const r = await tx
          .insertInto('webhook_delivery')
          .values({
            id: deliveryId,
            webhook_id: h.id,
            org_id: h.org_id,
            event_id: meta.eventId,
            event_type: type,
            body,
          })
          .onConflict((oc) => oc.columns(['webhook_id', 'event_id']).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (r) out.push(r.id);
      }
      return out;
    });
    for (const id of ids) await this.attempt(id);
    return ids.length;
  }

  /** Retries deliveries whose backoff has passed. Called by the worker every 30 s. */
  async retryDue(batch = 50): Promise<number> {
    const due = await this.db.withSystem((tx) =>
      tx
        .selectFrom('webhook_delivery')
        .select('id')
        .where('status', '=', 'pending')
        .where('next_attempt_at', '<=', new Date())
        .orderBy('next_attempt_at')
        .limit(batch)
        .execute(),
    );
    for (const d of due) await this.attempt(d.id);
    return due.length;
  }

  start(intervalMs = 30_000): () => void {
    const t = setInterval(() => {
      this.retryDue().catch((err) => logger.error({ err }, 'webhook retry loop failed'));
    }, intervalMs);
    return () => clearInterval(t);
  }

  private async attempt(deliveryId: string) {
    // Claim the delivery by pushing its next attempt out; concurrent workers then skip it.
    const d = await this.db.withSystem(async (tx) => {
      const row = await tx
        .selectFrom('webhook_delivery as d')
        .innerJoin('webhook as w', 'w.id', 'd.webhook_id')
        .select([
          'd.id',
          'd.event_id',
          'd.event_type',
          'd.body',
          'd.attempts',
          'd.webhook_id',
          'w.url',
          'w.secret_enc',
          'w.active',
        ])
        .where('d.id', '=', deliveryId)
        .where('d.status', '=', 'pending')
        .where('d.next_attempt_at', '<=', new Date())
        .forUpdate('d')
        .skipLocked()
        .executeTakeFirst();
      if (!row) return null;
      await tx
        .updateTable('webhook_delivery')
        .set({ next_attempt_at: sql`now() + interval '2 minutes'` as never })
        .where('id', '=', row.id)
        .execute();
      return row;
    });
    if (!d) return;
    if (!d.active) {
      await this.db.withSystem((tx) =>
        tx
          .updateTable('webhook_delivery')
          .set({ status: 'failed', last_error: 'Webhook is switched off' })
          .where('id', '=', d.id)
          .execute(),
      );
      return;
    }
    const res = await this.post(d.url, this.box.open(d.secret_enc), d.event_type, d.id, d.body);
    const attempts = d.attempts + 1;
    await this.db.withSystem(async (tx) => {
      if (res.ok) {
        await tx
          .updateTable('webhook_delivery')
          .set({
            status: 'succeeded',
            attempts,
            last_status: res.status,
            last_error: null,
            delivered_at: new Date(),
          })
          .where('id', '=', d.id)
          .execute();
        await tx
          .updateTable('webhook')
          .set({ consecutive_failures: 0 })
          .where('id', '=', d.webhook_id)
          .execute();
        return;
      }
      const exhausted = attempts >= MAX_ATTEMPTS;
      await tx
        .updateTable('webhook_delivery')
        .set({
          status: exhausted ? 'failed' : 'pending',
          attempts,
          last_status: res.status,
          last_error: res.error,
          next_attempt_at:
            sql`now() + make_interval(secs => ${BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)]})` as never,
        })
        .where('id', '=', d.id)
        .execute();
      if (exhausted) {
        const w = await tx
          .updateTable('webhook')
          .set({ consecutive_failures: sql`consecutive_failures + 1` as never })
          .where('id', '=', d.webhook_id)
          .returning('consecutive_failures')
          .executeTakeFirst();
        if (w && w.consecutive_failures >= DISABLE_AFTER)
          await tx
            .updateTable('webhook')
            .set({
              active: false,
              disabled_reason: `Switched off after ${DISABLE_AFTER} events could not be delivered`,
            })
            .where('id', '=', d.webhook_id)
            .execute();
      }
    });
  }

  /**
   * One HTTP POST: SSRF check, connection pinned to the checked address, no redirects, short
   * timeout, response body discarded after 1 KB. Any 2xx counts as delivered.
   */
  private async post(
    rawUrl: string,
    secret: string,
    type: string,
    deliveryId: string,
    body: string,
  ): Promise<{ ok: boolean; status: number | null; error: string | null }> {
    let target: Awaited<ReturnType<typeof checkWebhookUrl>>;
    try {
      target = await checkWebhookUrl(rawUrl, this.cfg.WEBHOOK_ALLOW_PRIVATE_TARGETS);
    } catch (e) {
      return { ok: false, status: null, error: (e as Error).message };
    }
    const { url, address, family } = target;
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      const req = lib.request(
        url,
        {
          method: 'POST',
          timeout: this.cfg.WEBHOOK_TIMEOUT_MS,
          // Pin the connection to the address that passed the SSRF check. Node may ask for a
          // list (autoSelectFamily) or a single address; answer both forms.
          lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
            o?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as never,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'user-agent': 'WatchDog-Webhooks/1.0',
            'x-wd-event': type,
            'x-wd-delivery': deliveryId,
            'x-wd-signature': signature(secret, body),
          },
        },
        (res) => {
          let n = 0;
          res.on('data', (c: Buffer) => {
            n += c.length;
            if (n > 1024) res.destroy();
          });
          res.on('close', () => {
            const s = res.statusCode ?? 0;
            resolve({
              ok: s >= 200 && s < 300,
              status: s,
              error: s >= 200 && s < 300 ? null : `HTTP ${s}`,
            });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', (e) => resolve({ ok: false, status: null, error: e.message.slice(0, 300) }));
      req.end(body);
    });
  }

  static readonly EVENTS = WEBHOOK_EVENTS;
}
