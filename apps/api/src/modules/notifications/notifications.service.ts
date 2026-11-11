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
import { monthStats } from '../insights/stats.js';
import { renewalPipeline } from '../business/contracts.controller.js';
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
const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
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
      case 'csat.low':
        return this.csatLow(String(payload.caseId));
      case 'review.monthly':
        return this.monthlyReview(String(payload.orgId), String(payload.month));
      case 'contract.renewal_requested':
        return this.contractRenewal(String(payload.renewalId));
      case 'renewal.digest':
        return this.renewalDigest(String(payload.userId), Boolean(payload.unowned));
      case 'product.lifecycle':
        return this.lifecycle(String(payload.productId));
      case 'partner.access':
        return this.partnerAccess(String(payload.delegationId));
      case 'visit.booked':
      case 'visit.cancelled':
        return this.visit(topic, String(payload.visitId), Boolean(payload.byStaff));
      case 'stock.low':
        return this.stockLow(
          payload as { depotId: string; productId: string; onHand: number; min: number },
        );
      case 'community.answered':
        return this.communityAnswer(String(payload.questionId), String(payload.answerId));
      default:
        return;
    }
  }

  /** A customer asked to renew a whole contract: the renewals mailbox and the account owner. */
  private async contractRenewal(id: string) {
    await this.db.withSystem(async (tx) => {
      const r = await sql<{
        org_id: string;
        org_name: string;
        ref: string;
        title: string;
        value_inr: string;
        ends_on: string;
        note: string | null;
        requester: string;
        owner_email: string | null;
        owner_locale: string | null;
        owner_id: string | null;
        devices: string;
      }>`
        SELECT c.org_id, o.name AS org_name, c.ref, c.title, c.value_inr,
               to_char(c.ends_on, 'DD Mon YYYY') AS ends_on, r.note,
               u.display_name || ' <' || u.email || '>' AS requester,
               w.email AS owner_email, w.locale AS owner_locale, w.id AS owner_id,
               (SELECT count(DISTINCT e.asset_id) FROM entitlement e
                 WHERE e.org_id = c.org_id AND e.contract_ref = c.ref) AS devices
          FROM renewal_request r
          JOIN contract c ON c.id = r.contract_id
          JOIN organization o ON o.id = c.org_id
          JOIN app_user u ON u.id = r.requested_by
          LEFT JOIN app_user w ON w.id = c.owner_id AND w.status = 'active'
         WHERE r.id = ${id}`.execute(tx);
      const x = r.rows[0];
      if (!x) return;
      const vars = {
        org: x.org_name,
        ref: x.ref,
        title: x.title,
        value: inr(Number(x.value_inr)),
        endsOn: x.ends_on,
        devices: x.devices,
        requester: x.requester,
        note: x.note ?? '—',
        url: `${this.cfg.PUBLIC_WEB_URL}/workspace/renewals`,
      };
      await this.send({
        to: this.cfg.RENEWALS_EMAIL,
        orgId: null,
        userId: null,
        key: 'contract_renewal_requested',
        vars,
      });
      if (x.owner_email && x.owner_email !== this.cfg.RENEWALS_EMAIL)
        await this.send({
          to: x.owner_email,
          orgId: null,
          userId: x.owner_id,
          locale: x.owner_locale ?? undefined,
          key: 'contract_renewal_requested',
          vars,
        });
    });
  }

  /** Weekly list of open renewals for an account owner (and unowned ones for managers). */
  private async renewalDigest(userId: string, unowned: boolean) {
    await this.db.withSystem(async (tx) => {
      const u = await tx
        .selectFrom('app_user')
        .select(['email', 'locale', 'status', 'display_name'])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!u || u.status !== 'active') return;
      const p = await renewalPipeline(tx, 90);
      const mine = p.items.filter(
        (i) =>
          i.stage !== 'won' &&
          i.stage !== 'lost' &&
          (i.ownerId === userId || (unowned && !i.ownerId)),
      );
      if (!mine.length) return;
      const h = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const listHtml = mine
        .slice(0, 40)
        .map(
          (i) =>
            `• ${h(i.orgName)}${i.ref ? ` — ${h(i.ref)}` : ''} — ${i.daysLeft < 0 ? `ended ${-i.daysLeft} days ago` : `ends in ${i.daysLeft} days`}` +
            `${i.valueInr !== null ? ` — ${inr(i.valueInr)}` : ''}${i.customerAsked ? ' — customer asked to renew' : ''}${i.ownerId ? '' : ' — no owner yet'}`,
        )
        .join('<br>');
      const value = inr(mine.reduce((n, i) => n + (i.valueInr ?? 0), 0));
      await this.send({
        to: u.email,
        orgId: null,
        userId,
        locale: u.locale,
        key: 'renewal_digest',
        vars: {
          count: mine.length,
          value,
          intro: `${u.display_name}, these contracts and coverage end soon and are not yet renewed.`,
          listHtml,
          url: `${this.cfg.PUBLIC_WEB_URL}/workspace/renewals`,
        },
      });
    });
  }

  /** A model reached end of sale or end of support: tell each organisation that owns one. */
  private async lifecycle(productId: string) {
    const STAGE: Record<string, string> = {
      eos_announced: 'end of sale announced',
      eos: 'end of sale',
      eol: 'end of support',
    };
    await this.db.withSystem(async (tx) => {
      const p = await sql<{
        model_name: string;
        lifecycle: string;
        eos: string | null;
        eol: string | null;
        note: string | null;
        replacement: string | null;
      }>`
        SELECT p.model_name, p.lifecycle, to_char(p.eos_date, 'DD Mon YYYY') AS eos,
               to_char(p.eol_date, 'DD Mon YYYY') AS eol, p.lifecycle_note AS note, r.model_name AS replacement
          FROM product p LEFT JOIN product r ON r.id = p.replacement_product_id
         WHERE p.id = ${productId}`.execute(tx);
      const x = p.rows[0];
      if (!x || x.lifecycle === 'ga') return;
      const owners = await sql<{ org_id: string; org_name: string; serials: string[] }>`
        SELECT a.org_id, o.name AS org_name, array_agg(a.serial_number ORDER BY a.serial_number) AS serials
          FROM asset a JOIN organization o ON o.id = a.org_id AND o.status = 'active'
         WHERE a.product_id = ${productId}
         GROUP BY a.org_id, o.name`.execute(tx);
      const h = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      for (const o of owners.rows) {
        const admins = await tx
          .selectFrom('user_role as ur')
          .innerJoin('app_user as u', 'u.id', 'ur.user_id')
          .select(['u.id', 'u.email', 'u.locale'])
          .where('ur.role_key', '=', 'customer_admin')
          .where('u.org_id', '=', o.org_id)
          .where('u.status', '=', 'active')
          .execute();
        const shown = o.serials.slice(0, 15);
        const serialsHtml =
          shown.map(h).join(', ') +
          (o.serials.length > shown.length ? ` and ${o.serials.length - shown.length} more` : '');
        const adviceHtml = [
          x.replacement ? `Suggested replacement: <b>${h(x.replacement)}</b>.` : '',
          x.note ? h(x.note) : '',
        ]
          .filter(Boolean)
          .join('<br>');
        for (const a of admins)
          await this.send({
            to: a.email,
            orgId: o.org_id,
            userId: a.id,
            locale: a.locale,
            key: 'lifecycle_notice',
            vars: {
              model: x.model_name,
              stage: STAGE[x.lifecycle] ?? x.lifecycle,
              org: o.org_name,
              count: o.serials.length,
              serialsHtml,
              eos: x.eos ?? 'not set',
              eol: x.eol ?? 'not set',
              adviceHtml,
              url: `${this.cfg.PUBLIC_WEB_URL}/portal/assets`,
            },
          });
      }
    });
  }

  /** Staff gave a partner access to a customer: the customer's administrators are told. */
  private async partnerAccess(id: string) {
    await this.db.withSystem(async (tx) => {
      const d = await tx
        .selectFrom('partner_delegation as d')
        .innerJoin('organization as p', 'p.id', 'd.partner_org_id')
        .innerJoin('organization as c', 'c.id', 'd.customer_org_id')
        .select([
          'd.customer_org_id',
          'd.expires_at',
          'd.revoked_at',
          'p.name as partner',
          'c.name as org',
        ])
        .where('d.id', '=', id)
        .executeTakeFirst();
      if (!d || d.revoked_at) return;
      const admins = await tx
        .selectFrom('user_role as ur')
        .innerJoin('app_user as u', 'u.id', 'ur.user_id')
        .select(['u.id', 'u.email', 'u.locale'])
        .where('ur.role_key', '=', 'customer_admin')
        .where('u.org_id', '=', d.customer_org_id)
        .where('u.status', '=', 'active')
        .execute();
      for (const a of admins) {
        const hi = (a.locale ?? 'en').startsWith('hi');
        const until = d.expires_at
          ? new Intl.DateTimeFormat(hi ? 'hi-IN' : 'en-IN', {
              dateStyle: 'medium',
              timeZone: 'Asia/Kolkata',
            }).format(d.expires_at)
          : null;
        await this.send({
          to: a.email,
          orgId: d.customer_org_id,
          userId: a.id,
          locale: a.locale,
          key: 'partner_access',
          vars: {
            partner: d.partner,
            org: d.org,
            untilText: until ? (hi ? ` (${until} तक)` : ` until ${until}`) : '',
            url: `${this.cfg.PUBLIC_WEB_URL}/portal/team`,
          },
        });
      }
    });
  }

  /** Visit booked or cancelled: the case requester and the engineer. */
  private async visit(topic: string, id: string, byStaff: boolean) {
    await this.db.withSystem(async (tx) => {
      const v = await tx
        .selectFrom('visit as v')
        .innerJoin('support_case as c', 'c.id', 'v.case_id')
        .innerJoin('app_user as r', 'r.id', 'c.requester_id')
        .leftJoin('app_user as e', 'e.id', 'v.engineer_id')
        .leftJoin('site as s', 's.id', 'v.site_id')
        .select([
          'v.kind',
          'v.starts_at',
          'v.contact_name',
          'v.contact_phone',
          'v.cancel_reason',
          'v.org_id',
          'c.number',
          'c.subject',
          'r.id as rid',
          'r.email as remail',
          'r.locale as rlocale',
          'e.id as eid',
          'e.email as eemail',
          'e.locale as elocale',
          'e.display_name as ename',
          's.name as site',
          's.city',
        ])
        .where('v.id', '=', id)
        .executeTakeFirst();
      if (!v) return;
      const h = (x: string) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const who = [
        { id: v.rid, email: v.remail, locale: v.rlocale, staff: false },
        ...(v.eid && v.eemail
          ? [{ id: v.eid, email: v.eemail, locale: v.elocale ?? 'en', staff: true }]
          : []),
      ];
      for (const u of who) {
        const hi = (u.locale ?? 'en').startsWith('hi');
        const what =
          v.kind === 'onsite'
            ? hi
              ? 'इंजीनियर विज़िट'
              : 'Engineer visit'
            : hi
              ? 'रिमोट सेशन'
              : 'Remote session';
        const when = new Intl.DateTimeFormat(hi ? 'hi-IN' : 'en-IN', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone: 'Asia/Kolkata',
        }).format(v.starts_at);
        await this.send({
          to: u.email,
          orgId: v.org_id,
          userId: u.id,
          locale: u.locale,
          key: topic === 'visit.booked' ? 'visit_booked' : 'visit_cancelled',
          thread: u.staff ? undefined : v.number,
          vars: {
            number: v.number,
            subject: v.subject,
            what,
            whatLower: what.toLowerCase(),
            when,
            engineer: v.ename ?? '—',
            whereHtml: v.site
              ? `${hi ? 'स्थान' : 'Where'}: ${h(v.site)}${v.city ? `, ${h(v.city)}` : ''}<br>`
              : '',
            contact: `${v.contact_name}, ${v.contact_phone}`,
            by: byStaff ? 'WatchDog Support' : hi ? 'ग्राहक' : 'the customer',
            reason: v.cancel_reason ?? '—',
            url: this.caseUrl(v.number, u.staff),
          },
        });
      }
    });
  }

  /** A depot fell below its minimum for a model: RMA coordinators are told. */
  private async stockLow(x: { depotId: string; productId: string; onHand: number; min: number }) {
    await this.db.withSystem(async (tx) => {
      const d = await tx
        .selectFrom('depot')
        .select('name')
        .where('id', '=', x.depotId)
        .executeTakeFirst();
      const pr = await tx
        .selectFrom('product')
        .select('model_name')
        .where('id', '=', x.productId)
        .executeTakeFirst();
      if (!d || !pr) return;
      const people = await tx
        .selectFrom('user_role as ur')
        .innerJoin('app_user as u', 'u.id', 'ur.user_id')
        .select(['u.id', 'u.email', 'u.locale'])
        .where('ur.role_key', '=', 'rma_coordinator')
        .where('u.status', '=', 'active')
        .execute();
      for (const u of people)
        await this.send({
          to: u.email,
          orgId: null,
          userId: u.id,
          locale: u.locale,
          key: 'stock_low',
          vars: {
            depot: d.name,
            model: pr.model_name,
            onHand: x.onHand,
            min: x.min,
            url: `${this.cfg.PUBLIC_WEB_URL}/workspace/stock`,
          },
        });
    });
  }

  /** Someone answered a community question: the asker hears about it. */
  private async communityAnswer(questionId: string, answerId: string) {
    await this.db.withSystem(async (tx) => {
      const r = await sql<{
        title: string;
        email: string;
        locale: string;
        status: string;
        asker: string;
        org_id: string;
        body: string;
        author: string;
      }>`
        SELECT q.title, u.email, u.locale, u.status, u.id AS asker, q.org_id, a.body,
               wd.public_name(a.author_id) || CASE WHEN a.by_staff THEN ' (WatchDog)' ELSE '' END AS author
          FROM forum_question q
          JOIN app_user u ON u.id = q.author_id
          JOIN forum_answer a ON a.id = ${answerId}
         WHERE q.id = ${questionId}`.execute(tx);
      const x = r.rows[0];
      if (!x || x.status !== 'active') return;
      await this.send({
        to: x.email,
        orgId: x.org_id,
        userId: x.asker,
        locale: x.locale,
        key: 'community_answer',
        vars: {
          title: x.title,
          author: x.author,
          excerpt: x.body.length > 400 ? `${x.body.slice(0, 400)}…` : x.body,
          url: `${this.cfg.PUBLIC_WEB_URL}/community/${questionId}`,
        },
      });
    });
  }

  /** A rating of 1 or 2: every active support manager is asked to call the customer back. */
  private async csatLow(caseId: string) {
    await this.db.withSystem(async (tx) => {
      const r = await tx
        .selectFrom('csat_response as r')
        .innerJoin('support_case as c', 'c.id', 'r.case_id')
        .innerJoin('organization as o', 'o.id', 'c.org_id')
        .innerJoin('app_user as u', 'u.id', 'r.user_id')
        .select([
          'c.org_id',
          'c.number',
          'c.subject',
          'o.name',
          'u.display_name',
          'u.email',
          'u.phone',
          'r.score',
          'r.comment',
        ])
        .where('r.case_id', '=', caseId)
        .executeTakeFirst();
      if (!r) return;
      const managers = await tx
        .selectFrom('user_role as ur')
        .innerJoin('app_user as u', 'u.id', 'ur.user_id')
        .select(['u.id', 'u.email', 'u.locale'])
        .where('ur.role_key', '=', 'support_manager')
        .where('u.status', '=', 'active')
        .execute();
      for (const m of managers)
        await this.send({
          to: m.email,
          orgId: r.org_id,
          userId: m.id,
          key: 'csat_low',
          locale: m.locale,
          vars: {
            number: r.number,
            subject: r.subject,
            org: r.name,
            contact: r.display_name,
            phone: r.phone ?? r.email,
            score: r.score,
            comment: r.comment ?? '—',
            url: `${this.cfg.PUBLIC_WEB_URL}/workspace/low-ratings`,
          },
        });
    });
  }

  /** Monthly service review to each active customer administrator, in their language. */
  private async monthlyReview(orgId: string, month: string) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    await this.db.withSystem(async (tx) => {
      const org = await tx
        .selectFrom('organization')
        .select('name')
        .where('id', '=', orgId)
        .executeTakeFirst();
      if (!org) return;
      const s = await monthStats(tx, orgId, month, next);
      // Nothing happened and nothing is about to: no email.
      if (!s.opened && !s.resolved && !s.openNow && !s.expiringSoon) return;
      const admins = await tx
        .selectFrom('user_role as ur')
        .innerJoin('app_user as u', 'u.id', 'ur.user_id')
        .select(['u.id', 'u.email', 'u.locale'])
        .where('ur.role_key', '=', 'customer_admin')
        .where('u.org_id', '=', orgId)
        .where('u.status', '=', 'active')
        .execute();
      for (const a of admins) {
        const hi = (a.locale ?? 'en').startsWith('hi');
        const dur = (min: number | null) => {
          if (min === null) return '—';
          const h = Math.floor(min / 60);
          const mm = min % 60;
          if (hi) return h ? `${h} घंटे ${mm} मिनट` : `${mm} मिनट`;
          return h ? `${h} h ${mm} min` : `${mm} min`;
        };
        await this.send({
          to: a.email,
          orgId,
          userId: a.id,
          key: 'monthly_review',
          locale: a.locale,
          vars: {
            org: org.name,
            month: new Intl.DateTimeFormat(hi ? 'hi-IN' : 'en-IN', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(Date.UTC(y, m - 1, 1))),
            opened: s.opened,
            resolved: s.resolved,
            openNow: s.openNow,
            firstResponse: dur(s.medianFirstResponseMinutes),
            slaMet: s.slaMetPct === null ? '—' : `${s.slaMetPct}%`,
            csat:
              s.csatAverage === null
                ? hi
                  ? 'अभी कोई रेटिंग नहीं'
                  : 'No ratings this month'
                : hi
                  ? `5 में से ${s.csatAverage} (${s.csatResponses} रेटिंग)`
                  : `${s.csatAverage} out of 5 (${s.csatResponses} rating${s.csatResponses === 1 ? '' : 's'})`,
            expiring: s.expiringSoon,
            url: `${this.cfg.PUBLIC_WEB_URL}/portal/reports`,
          },
        });
      }
    });
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

  /** Whoever carries the P1 phone right now hears about every new P1 (email and SMS). */
  private async p1OnCall(
    tx: Tx,
    c: { id: string; org_id: string; number: string; subject: string; org_name: string },
    due: Date | null,
  ) {
    const people = await sql<{ id: string; email: string; phone: string | null; locale: string }>`
      SELECT u.id, u.email, u.phone, u.locale FROM app_user u
       WHERE u.status = 'active' AND wd.on_shift(u.id, true)`.execute(tx);
    if (!people.rows.length) return;
    const a = await tx
      .selectFrom('support_case as sc')
      .leftJoin('app_user as u', 'u.id', 'sc.assignee_id')
      .select('u.display_name')
      .where('sc.id', '=', c.id)
      .executeTakeFirst();
    for (const u of people.rows) {
      await this.send({
        to: u.email,
        orgId: c.org_id,
        userId: u.id,
        locale: u.locale,
        key: 'p1_oncall',
        vars: {
          number: c.number,
          org: c.org_name,
          subject: c.subject,
          assignee: a?.display_name ?? 'nobody yet',
          due: due ? fmtIst(due) : 'see the case',
          url: this.caseUrl(c.number, true),
        },
      });
      if (u.phone) {
        await this.sms.send(u.phone, 'WD_P1_ONCALL', { number: c.number });
        await tx
          .insertInto('notification')
          .values({
            org_id: c.org_id,
            user_id: u.id,
            channel: 'sms',
            recipient: u.phone,
            template_key: 'WD_P1_ONCALL',
            status: 'sent',
            sent_at: new Date(),
            payload: JSON.stringify({ number: c.number }),
          })
          .execute();
      }
    }
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
      if (c.severity === 'P1') await this.p1OnCall(tx, c, fr?.due_at ?? null);
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
