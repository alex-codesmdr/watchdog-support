import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  RMA_STATUS_LABELS,
  RMA_TYPE_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  type CaseStatusKey,
  type RmaStatus,
  type Severity,
} from '@wd/contracts';
import type { AppConfig } from '../../config.js';
import type { Database, Tx } from '../../db/database.js';
import { CONFIG, DB, IDENTITY_PROVISIONER, MAIL_TRANSPORT, SMS_ADAPTER } from '../../tokens.js';
import { logger } from '../../common/logger.js';
import { htmlToText } from '../../common/sanitize.js';
import { Signer } from '../../common/signing.js';
import type { IdentityProvisioner } from '../identity/provisioner.js';
import type { MailTransport, SmsAdapter } from './mailer.js';
import { render, type TemplateKey } from './templates.js';

const fmtIst = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
const ymd = (d: Date | string) =>
  d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);
const excerpt = (html: string) => {
  const t = htmlToText(html);
  return t.length > 600 ? `${t.slice(0, 600)}…` : t;
};

/** Turns outbox events into emails / SMS. Runs in the worker; every send is recorded in `notification`. */
@Injectable()
export class NotificationsService {
  private readonly signer: Signer;
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
    @Inject(IDENTITY_PROVISIONER) private readonly idp: IdentityProvisioner,
  ) {
    this.signer = new Signer(cfg.APP_SIGNING_KEY);
  }

  async handle(topic: string, payload: Record<string, unknown>): Promise<void> {
    switch (topic) {
      case 'registration.received':
      case 'registration.approved':
      case 'registration.rejected':
        return this.registration(topic, String(payload.registrationId));
      case 'case.created':
        return this.caseCreated(String(payload.caseId));
      case 'case.message.public_created':
        return this.caseMessage(
          String(payload.caseId),
          String(payload.messageId),
          Boolean(payload.byStaff),
        );
      case 'case.status_changed':
        return this.caseStatus(
          String(payload.caseId),
          payload.from as CaseStatusKey,
          payload.to as CaseStatusKey,
          Boolean(payload.byStaff),
        );
      case 'case.customer_escalated':
        return this.customerEscalated(String(payload.caseId));
      case 'sla.warning':
      case 'sla.breached':
        return this.sla(
          topic,
          payload as {
            caseId: string;
            metric: string;
            threshold: number;
            actions: string[];
            escalatedTo: number | null;
          },
        );
      case 'renewal.requested':
        return this.renewal(String(payload.renewalId));
      case 'rma.status_changed':
        return this.rmaChanged(String(payload.rmaId), payload.to as RmaStatus);
      case 'advisory.published':
        return this.advisory(String(payload.advisoryId), Boolean(payload.update));
      case 'user.invited':
        return this.userInvited(String(payload.userId), String(payload.invitedBy));
      case 'coverage.expiring':
        return this.coverageExpiring(
          String(payload.orgId),
          Number(payload.days),
          payload.entitlementIds as string[],
        );
      default:
        return;
    }
  }

  /**
   * New or revised advisory: subscribers whose filters match, plus customer administrators whose
   * organisation has an installed affected device (they are told how many).
   */
  private async advisory(id: string, update: boolean) {
    const RANK = { informational: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
    await this.db.withSystem(async (tx) => {
      const a = await tx
        .selectFrom('advisory')
        .select([
          'wd_id',
          'title',
          'summary',
          'severity',
          'cvss_score',
          'status',
          'revision',
          'revision_note',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!a || a.status !== 'published') return;
      const prods = await tx
        .selectFrom('advisory_affected as x')
        .innerJoin('product as p', 'p.id', 'x.product_id')
        .select(['p.id', 'p.model_name', 'p.family_id'])
        .where('x.advisory_id', '=', id)
        .execute();
      const families = [...new Set(prods.map((p) => p.family_id))];
      const base = {
        wdId: a.wd_id,
        title: a.title,
        summary: a.summary,
        severityLabel: a.severity.charAt(0).toUpperCase() + a.severity.slice(1),
        cvss: a.cvss_score !== null ? ` (CVSS ${Number(a.cvss_score).toFixed(1)})` : '',
        products: prods.map((p) => p.model_name).join(', '),
        prefix: update ? 'Updated ' : '',
        revision: update && a.revision_note ? ` Revision ${a.revision}: ${a.revision_note}` : '',
        url: `${this.cfg.PUBLIC_WEB_URL}/advisories/${a.wd_id}`,
      };
      const to = new Map<
        string,
        { id: string; orgId: string | null; locale: string; yourDevices: string }
      >();
      const subs = await tx
        .selectFrom('advisory_subscription as s')
        .innerJoin('app_user as u', 'u.id', 's.user_id')
        .select(['u.id', 'u.email', 'u.org_id', 'u.locale', 's.family_ids', 's.min_severity'])
        .where('u.status', '=', 'active')
        .execute();
      for (const s of subs)
        if (
          RANK[a.severity] >= RANK[s.min_severity] &&
          (!s.family_ids.length || s.family_ids.some((f) => families.includes(f)))
        )
          to.set(s.email, { id: s.id, orgId: s.org_id, locale: s.locale, yourDevices: '' });
      if (!update && a.severity !== 'informational' && prods.length) {
        const exposed = await tx
          .selectFrom('asset')
          .select(['org_id', sql<string>`count(*)`.as('n')])
          .where(
            'product_id',
            'in',
            prods.map((p) => p.id),
          )
          .where('retired_at', 'is', null)
          .groupBy('org_id')
          .execute();
        if (exposed.length) {
          const admins = await tx
            .selectFrom('user_role as r')
            .innerJoin('app_user as u', 'u.id', 'r.user_id')
            .select(['u.id', 'u.email', 'u.org_id', 'u.locale'])
            .where('r.role_key', '=', 'customer_admin')
            .where('u.status', '=', 'active')
            .where(
              'u.org_id',
              'in',
              exposed.map((e) => e.org_id),
            )
            .execute();
          for (const m of admins) {
            const n = Number(exposed.find((e) => e.org_id === m.org_id)?.n ?? 0);
            to.set(m.email, {
              id: m.id,
              orgId: m.org_id,
              locale: m.locale,
              yourDevices: ` Your organisation has ${n} installed device${n === 1 ? '' : 's'} of the affected models.`,
            });
          }
        }
      }
      for (const [email, u] of to)
        await this.send({
          to: email,
          orgId: u.orgId,
          userId: u.id,
          key: 'advisory_published',
          locale: u.locale,
          vars: { ...base, yourDevices: u.yourDevices },
        });
    });
  }

  /**
   * RMA updates go to the requester and the case requester; new requests also alert the RMA
   * coordinators. Shipping details are included so the customer need not sign in.
   */
  private async rmaChanged(id: string, to: RmaStatus) {
    const h = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    await this.db.withSystem(async (tx) => {
      const r = await tx
        .selectFrom('rma as r')
        .innerJoin('support_case as c', 'c.id', 'r.case_id')
        .innerJoin('asset as a', 'a.id', 'r.asset_id')
        .innerJoin('product as p', 'p.id', 'a.product_id')
        .innerJoin('organization as o', 'o.id', 'r.org_id')
        .select([
          'r.number',
          'r.org_id',
          'r.type',
          'r.requested_by',
          'r.fault_description',
          'r.replacement_serial',
          'r.outbound_courier',
          'r.outbound_tracking',
          'c.number as case_number',
          'c.requester_id',
          'a.serial_number',
          'p.model_name',
          'o.name as org_name',
        ])
        .where('r.id', '=', id)
        .executeTakeFirst();
      if (!r) return;
      const url = `${this.cfg.PUBLIC_WEB_URL}/portal/rmas/${r.number}`;
      if (to === 'requested') {
        for (const m of await this.usersWithRole(tx, ['rma_coordinator']))
          await this.send({
            to: m.email,
            orgId: null,
            userId: m.id,
            key: 'rma_requested',
            vars: {
              rma: r.number,
              org: r.org_name,
              typeLabel: RMA_TYPE_LABELS[r.type].toLowerCase(),
              model: r.model_name,
              serial: r.serial_number,
              caseNumber: r.case_number,
              fault: r.fault_description.slice(0, 300),
              url: `${this.cfg.PUBLIC_WEB_URL}/workspace/rmas/${r.number}`,
            },
          });
      }
      const DETAIL: Partial<Record<RmaStatus, string>> = {
        requested:
          'We received your request. An RMA coordinator reviews it within one business day.',
        approved:
          r.type === 'advance'
            ? 'Approved. We will ship the replacement first and tell you when it leaves our warehouse.'
            : 'Approved. Download the RMA form from the RMA page, pack the faulty unit with the form, and enter the courier tracking number once it is on its way.',
        rejected: 'This request was not approved. The reason is on the RMA page.',
        cancelled: 'This RMA was cancelled.',
        received: 'We received the faulty unit.',
        replacement_shipped: `Replacement serial ${h(r.replacement_serial ?? '')} has shipped${r.outbound_courier ? ` with ${h(r.outbound_courier)}` : ''}, tracking number <b>${h(r.outbound_tracking ?? '')}</b>. Support coverage has moved to the new serial.`,
        closed: 'This RMA is complete.',
      };
      const users = await tx
        .selectFrom('app_user')
        .select(['id', 'email', 'locale', 'status'])
        .where('id', 'in', [r.requested_by, r.requester_id])
        .execute();
      for (const u of users.filter((x) => x.status === 'active'))
        await this.send({
          to: u.email,
          orgId: r.org_id,
          userId: u.id,
          key: 'rma_update',
          locale: u.locale,
          vars: {
            rma: r.number,
            statusLabel: RMA_STATUS_LABELS[to],
            model: r.model_name,
            serial: r.serial_number,
            caseNumber: r.case_number,
            detailHtml: DETAIL[to] ?? '',
            url,
          },
        });
    });
  }

  /** Renewal quote request → the renewals/sales mailbox (CRM adapter replaces this in Phase 4). */
  private async renewal(id: string) {
    const TIER: Record<string, string> = {
      standard: 'Standard',
      premium: 'Premium',
      mission_critical: 'Mission-Critical',
    };
    await this.db.withSystem(async (tx) => {
      const r = await tx
        .selectFrom('renewal_request as r')
        .innerJoin('asset as a', 'a.id', 'r.asset_id')
        .innerJoin('product as p', 'p.id', 'a.product_id')
        .innerJoin('organization as o', 'o.id', 'r.org_id')
        .innerJoin('app_user as u', 'u.id', 'r.requested_by')
        .leftJoin('entitlement as e', 'e.id', 'r.entitlement_id')
        .select([
          'r.org_id',
          'r.desired_tier',
          'r.note',
          'a.serial_number',
          'p.model_name',
          'o.name as org_name',
          'u.display_name',
          'u.email',
          'e.kind',
          'e.tier',
          'e.ends_on',
        ])
        .where('r.id', '=', id)
        .executeTakeFirst();
      if (!r) return;
      const coverage = r.ends_on
        ? `${TIER[r.tier ?? ''] ?? r.tier} ${r.kind} until ${ymd(r.ends_on as unknown as Date | string)}`
        : 'none on record';
      await this.send({
        to: this.cfg.RENEWALS_EMAIL,
        orgId: null,
        userId: null,
        key: 'renewal_requested',
        vars: {
          org: r.org_name,
          serial: r.serial_number,
          model: r.model_name,
          requester: `${r.display_name} <${r.email}>`,
          coverage,
          tier: r.desired_tier ? (TIER[r.desired_tier] ?? r.desired_tier) : 'same as today',
          note: r.note ?? '—',
        },
      });
    });
  }

  /** Expiry reminder to every active customer administrator of the organisation. */
  private async coverageExpiring(orgId: string, days: number, entitlementIds: string[]) {
    if (!entitlementIds?.length) return;
    const h = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    await this.db.withSystem(async (tx) => {
      const rows = await tx
        .selectFrom('entitlement as e')
        .innerJoin('asset as a', 'a.id', 'e.asset_id')
        .innerJoin('product as p', 'p.id', 'a.product_id')
        .innerJoin('organization as o', 'o.id', 'e.org_id')
        .select(['a.serial_number', 'p.model_name', 'e.ends_on', 'o.name as org_name'])
        .where('e.id', 'in', entitlementIds)
        .where('e.org_id', '=', orgId)
        .orderBy('e.ends_on')
        .execute();
      if (!rows.length) return;
      const date = ymd;
      const shown = rows.slice(0, 20);
      const listHtml =
        shown
          .map((r) => `• ${h(r.model_name)} — ${h(r.serial_number)} — ends ${date(r.ends_on)}`)
          .join('<br>') +
        (rows.length > shown.length ? `<br>…and ${rows.length - shown.length} more` : '');
      const admins = await tx
        .selectFrom('user_role as ur')
        .innerJoin('app_user as u', 'u.id', 'ur.user_id')
        .select(['u.id', 'u.email', 'u.locale'])
        .where('ur.role_key', '=', 'customer_admin')
        .where('u.org_id', '=', orgId)
        .where('u.status', '=', 'active')
        .execute();
      for (const a of admins)
        await this.send({
          to: a.email,
          orgId,
          userId: a.id,
          key: 'coverage_expiring',
          locale: a.locale,
          vars: {
            org: rows[0]!.org_name,
            days,
            count: rows.length,
            earliest: date(rows[0]!.ends_on),
            listHtml,
            url: `${this.cfg.PUBLIC_WEB_URL}/portal/assets`,
          },
        });
    });
  }

  private async registration(topic: string, id: string) {
    const r = await this.db.withSystem((tx) =>
      tx
        .selectFrom('registration as r')
        .innerJoin('organization as o', 'o.id', 'r.org_id')
        .select(['r.org_id', 'r.admin_name', 'r.admin_email', 'o.name'])
        .where('r.id', '=', id)
        .executeTakeFirst(),
    );
    if (!r) return;
    const vars = { name: r.admin_name, org: r.name, email: r.admin_email };
    if (topic === 'registration.received') {
      await this.send({
        to: r.admin_email,
        orgId: r.org_id,
        userId: null,
        key: 'registration_received',
        vars,
      });
      const admins = await this.db.withSystem((tx) => this.usersWithRole(tx, ['system_admin']));
      for (const a of admins)
        await this.send({
          to: a.email,
          orgId: null,
          userId: a.id,
          key: 'staff_registration_pending',
          vars: { ...vars, url: `${this.cfg.PUBLIC_WEB_URL}/admin/registrations` },
        });
    } else if (topic === 'registration.approved') {
      await this.idp.invite({ email: r.admin_email, displayName: r.admin_name });
      await this.send({
        to: r.admin_email,
        orgId: r.org_id,
        userId: null,
        key: 'registration_approved',
        vars: { ...vars, url: this.cfg.PUBLIC_WEB_URL },
      });
    } else {
      await this.send({
        to: r.admin_email,
        orgId: r.org_id,
        userId: null,
        key: 'registration_rejected',
        vars,
      });
    }
  }

  /** A customer administrator added someone: create their sign-in and tell them who invited them. */
  private async userInvited(userId: string, invitedBy: string) {
    const r = await this.db.withSystem((tx) =>
      tx
        .selectFrom('app_user as u')
        .innerJoin('organization as o', 'o.id', 'u.org_id')
        .leftJoin('app_user as by', (j) => j.on('by.id', '=', invitedBy))
        .select([
          'u.email',
          'u.display_name',
          'u.status',
          'u.org_id',
          'u.locale',
          'o.name',
          'by.display_name as inviter',
        ])
        .where('u.id', '=', userId)
        .executeTakeFirst(),
    );
    if (!r || r.status !== 'invited') return;
    await this.idp.invite({ email: r.email, displayName: r.display_name });
    await this.send({
      to: r.email,
      orgId: r.org_id,
      userId,
      key: 'user_invited',
      locale: r.locale,
      vars: {
        name: r.display_name,
        org: r.name,
        inviter: r.inviter ?? 'Your administrator',
        url: this.cfg.PUBLIC_WEB_URL,
      },
    });
  }

  private async loadCase(tx: Tx, id: string) {
    return tx
      .selectFrom('support_case as c')
      .innerJoin('app_user as u', 'u.id', 'c.requester_id')
      .innerJoin('organization as o', 'o.id', 'c.org_id')
      .select([
        'c.id',
        'c.org_id',
        'c.number',
        'c.subject',
        'c.severity',
        'c.assignee_id',
        'u.id as requester_id',
        'u.email',
        'u.phone',
        'u.display_name',
        'u.locale',
        'o.name as org_name',
      ])
      .where('c.id', '=', id)
      .executeTakeFirst();
  }

  private caseUrl(number: string, staff = false) {
    return `${this.cfg.PUBLIC_WEB_URL}/${staff ? 'workspace' : 'portal'}/cases/${number}`;
  }

  private threadHeaders(number: string): { replyTo: string; headers: Record<string, string> } {
    const ref = `<case-${number}@${this.cfg.MAIL_REPLY_DOMAIN}>`;
    return {
      replyTo: `${this.cfg.MAIL_REPLY_LOCALPART}+${this.signer.replyToken(number)}@${this.cfg.MAIL_REPLY_DOMAIN}`,
      headers: { References: ref, 'In-Reply-To': ref, 'X-WD-Case': number },
    };
  }

  private async caseCreated(caseId: string) {
    await this.db.withSystem(async (tx) => {
      const c = await this.loadCase(tx, caseId);
      if (!c) return;
      const fr = await tx
        .selectFrom('sla_clock')
        .select('due_at')
        .where('case_id', '=', caseId)
        .where('metric', '=', 'first_response')
        .executeTakeFirst();
      await this.send({
        to: c.email,
        orgId: c.org_id,
        userId: c.requester_id,
        locale: c.locale,
        key: 'case_created',
        thread: c.number,
        vars: {
          number: c.number,
          subject: c.subject,
          severity: SEVERITY_LABELS[c.severity as Severity],
          firstResponseDue: fr ? fmtIst(fr.due_at) : 'per your contract',
          url: this.caseUrl(c.number),
        },
      });
      if (c.severity === 'P1' && c.phone) {
        await this.sms.send(c.phone, 'WD_CASE_P1_OPENED', { number: c.number });
        await tx
          .insertInto('notification')
          .values({
            org_id: c.org_id,
            user_id: c.requester_id,
            channel: 'sms',
            recipient: c.phone,
            template_key: 'WD_CASE_P1_OPENED',
            status: 'sent',
            sent_at: new Date(),
            payload: JSON.stringify({ number: c.number }),
          })
          .execute();
      }
    });
  }

  private async caseMessage(caseId: string, messageId: string, byStaff: boolean) {
    await this.db.withSystem(async (tx) => {
      const c = await this.loadCase(tx, caseId);
      const m = await tx
        .selectFrom('case_message as m')
        .leftJoin('app_user as u', 'u.id', 'm.author_id')
        .select(['m.body_html', 'm.visibility', 'u.display_name'])
        .where('m.id', '=', messageId)
        .executeTakeFirst();
      // Defence in depth: never email an internal note to anyone.
      if (!c || !m || m.visibility !== 'public') return;
      if (byStaff) {
        await this.send({
          to: c.email,
          orgId: c.org_id,
          userId: c.requester_id,
          locale: c.locale,
          key: 'case_reply',
          thread: c.number,
          vars: {
            number: c.number,
            author: `${m.display_name ?? 'WatchDog'} (WatchDog Support)`,
            excerpt: excerpt(m.body_html),
            url: this.caseUrl(c.number),
          },
        });
      } else if (c.assignee_id) {
        const a = await tx
          .selectFrom('app_user')
          .select(['id', 'email'])
          .where('id', '=', c.assignee_id)
          .executeTakeFirst();
        if (a)
          await this.send({
            to: a.email,
            orgId: null,
            userId: a.id,
            key: 'case_customer_reply',
            vars: {
              number: c.number,
              subject: c.subject,
              author: m.display_name ?? c.display_name,
              org: c.org_name,
              excerpt: excerpt(m.body_html),
              url: this.caseUrl(c.number, true),
            },
          });
      }
    });
  }

  private async caseStatus(
    caseId: string,
    from: CaseStatusKey,
    to: CaseStatusKey,
    byStaff: boolean,
  ) {
    if (!byStaff) return;
    await this.db.withSystem(async (tx) => {
      const c = await this.loadCase(tx, caseId);
      if (!c) return;
      if (to === 'resolved') {
        const token = this.signer.sign({ k: 'csat', c: c.id, u: c.requester_id }, 30 * 86_400);
        await this.send({
          to: c.email,
          orgId: c.org_id,
          userId: c.requester_id,
          locale: c.locale,
          key: 'case_resolved',
          thread: c.number,
          vars: {
            number: c.number,
            subject: c.subject,
            url: `${this.cfg.PUBLIC_WEB_URL}/csat?token=${encodeURIComponent(token)}`,
          },
        });
      } else {
        await this.send({
          to: c.email,
          orgId: c.org_id,
          userId: c.requester_id,
          locale: c.locale,
          key: 'case_status',
          thread: c.number,
          vars: {
            number: c.number,
            subject: c.subject,
            from: STATUS_LABELS[from],
            status: STATUS_LABELS[to],
            url: this.caseUrl(c.number),
          },
        });
      }
    });
  }

  private async customerEscalated(caseId: string) {
    await this.db.withSystem(async (tx) => {
      const c = await this.loadCase(tx, caseId);
      if (!c) return;
      for (const m of await this.usersWithRole(tx, ['support_manager']))
        await this.send({
          to: m.email,
          orgId: null,
          userId: m.id,
          key: 'case_customer_escalated',
          vars: {
            number: c.number,
            subject: c.subject,
            org: c.org_name,
            severity: c.severity,
            url: this.caseUrl(c.number, true),
          },
        });
    });
  }

  /** Internal SLA alerts. Recipients come from the escalation rule actions recorded on the event. */
  private async sla(
    topic: string,
    p: {
      caseId: string;
      metric: string;
      threshold: number;
      actions: string[];
      escalatedTo: number | null;
    },
  ) {
    const METRIC: Record<string, string> = {
      first_response: 'First response',
      update: 'Customer update',
      restoration: 'Service restoration',
      resolution: 'Resolution',
    };
    const TIER: Record<string, string> = {
      standard: 'Standard',
      premium: 'Premium',
      mission_critical: 'Mission-Critical',
    };
    await this.db.withSystem(async (tx) => {
      const c = await this.loadCase(tx, p.caseId);
      if (!c) return;
      const meta = await tx
        .selectFrom('support_case as sc')
        .leftJoin('app_user as a', 'a.id', 'sc.assignee_id')
        .select([
          'sc.tier',
          'a.id as assignee_id',
          'a.email as assignee_email',
          'a.display_name as assignee_name',
        ])
        .where('sc.id', '=', p.caseId)
        .executeTakeFirst();
      const clock = await tx
        .selectFrom('sla_clock')
        .select('due_at')
        .where('case_id', '=', p.caseId)
        .where('metric', '=', p.metric as never)
        .executeTakeFirst();
      const vars = {
        number: c.number,
        subject: c.subject,
        severity: c.severity,
        tier: TIER[meta?.tier ?? 'standard'] ?? 'Standard',
        org: c.org_name,
        metricLabel: METRIC[p.metric] ?? p.metric,
        threshold: p.threshold,
        due: clock ? fmtIst(clock.due_at) : '',
        assignee: meta?.assignee_name ?? 'nobody (unassigned)',
        escalation: p.escalatedTo
          ? `The case was automatically escalated to ${p.escalatedTo >= 4 ? 'Engineering' : `L${p.escalatedTo}`}.`
          : '',
        url: this.caseUrl(c.number, true),
      };
      const key = topic === 'sla.breached' ? 'sla_breached' : 'sla_warning';
      const to = new Map<string, string | null>();
      if (p.actions.includes('notify_assignee') && meta?.assignee_email)
        to.set(meta.assignee_email, meta.assignee_id);
      if (p.actions.includes('notify_managers'))
        for (const m of await this.usersWithRole(tx, ['support_manager'])) to.set(m.email, m.id);
      if (p.actions.includes('notify_matrix')) {
        const maxLevel = p.threshold >= 100 ? 2 : 1;
        const contacts = await tx
          .selectFrom('escalation_contact')
          .select(['email'])
          .where('active', '=', true)
          .where('level', '<=', maxLevel)
          .where((eb) => eb.or([eb('tier', 'is', null), eb('tier', '=', meta?.tier ?? 'standard')]))
          .execute();
        for (const ct of contacts) if (!to.has(ct.email)) to.set(ct.email, null);
      }
      for (const [email, userId] of to)
        await this.send({ to: email, orgId: null, userId, key, vars });
    });
  }

  private usersWithRole(tx: Tx, roles: string[]) {
    return tx
      .selectFrom('user_role as r')
      .innerJoin('app_user as u', 'u.id', 'r.user_id')
      .select(['u.id', 'u.email'])
      .where('r.role_key', 'in', roles)
      .where('u.status', '!=', 'disabled')
      .execute();
  }

  private async send(n: {
    to: string;
    orgId: string | null;
    userId: string | null;
    key: TemplateKey;
    vars: Record<string, string | number | null | undefined>;
    locale?: string;
    thread?: string;
  }) {
    const r = await render(n.key, n.vars, n.locale);
    const t = n.thread ? this.threadHeaders(n.thread) : undefined;
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    try {
      await this.mail.send({
        to: n.to,
        subject: r.subject,
        html: r.html,
        text: r.text,
        replyTo: t?.replyTo,
        headers: t?.headers,
      });
    } catch (e) {
      status = 'failed';
      error = (e as Error).message.slice(0, 500);
      logger.error({ err: e, template: n.key }, 'email send failed');
    }
    await this.db.withSystem((tx) =>
      tx
        .insertInto('notification')
        .values({
          org_id: n.orgId,
          user_id: n.userId,
          channel: 'email',
          recipient: n.to,
          template_key: n.key,
          status,
          error,
          sent_at: status === 'sent' ? new Date() : null,
          payload: JSON.stringify({ subject: r.subject }),
        })
        .execute(),
    );
    if (status === 'failed') throw new Error(`email ${n.key} failed: ${error}`);
  }
}
