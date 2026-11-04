import { Inject, Injectable } from '@nestjs/common';
import { SEVERITY_LABELS, STATUS_LABELS, type CaseStatusKey, type Severity } from '@wd/contracts';
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
      default:
        return;
    }
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
