import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  canTransition,
  CUSTOMER_TRANSITIONS,
  OPEN_STATUSES,
  REOPEN_WINDOW_DAYS,
  STAFF_TRANSITIONS,
  type CaseDetail,
  type CaseListQuery,
  type CaseStatus,
  type CaseSummary,
  type CreateCaseRequest,
  type CsatRequest,
  type ReplyRequest,
} from '@wd/contracts';
import { asCase } from '@wd/rbac';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { conflict, forbidden, notFound, ProblemError, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';
import { textToHtml } from '../../common/sanitize.js';
import {
  markMet,
  nextClock,
  pauseAll,
  rearmUpdateClock,
  resolvePolicy,
  resumeAll,
  sortClocks,
  startClocks,
  toView,
  unmet,
  type ResolvedPolicy,
} from './sla.js';

const TIER_RANK: Record<string, number> = { mission_critical: 3, premium: 2, standard: 1 };
type Actor = 'staff' | 'customer';

interface CaseRow {
  id: string;
  org_id: string;
  number: string;
  requester_id: string;
  status: string;
  severity: string;
  tier: string | null;
  support_level: number;
  closed_at: Date | null;
  customer_escalated_at: Date | null;
  version: number;
}

@Injectable()
export class CasesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ------------------------------------------------------------------ create
  async create(
    p: Principal,
    ctx: RequestContext,
    body: CreateCaseRequest,
  ): Promise<{ id: string; number: string }> {
    return this.db.withTenant(p, async (tx) => {
      const { orgId, requesterId } = await this.targetOrg(tx, p, body);
      const serial = body.serialNumber.toUpperCase();
      const asset = await tx
        .selectFrom('asset')
        .select(['id', 'org_id', 'current_version'])
        .where('serial_number', '=', serial)
        .where('org_id', '=', orgId)
        .executeTakeFirst();
      if (!asset)
        throw unprocessable(
          'serial-not-found',
          'We could not find this serial number',
          'Check the serial on the device label, or ask your administrator to register the asset.',
        );

      const ent = await tx
        .selectFrom('entitlement')
        .select(['id', 'tier'])
        .where('asset_id', '=', asset.id)
        .where(sql<boolean>`current_date BETWEEN starts_on AND ends_on`)
        .execute();
      const best = ent.sort((a, b) => TIER_RANK[b.tier]! - TIER_RANK[a.tier]!)[0];
      if (!best && !p.isInternal)
        throw unprocessable(
          'not-entitled',
          'This device has no active warranty or support contract',
          'Request a renewal quote, or contact your WatchDog account manager.',
        );
      const tier = best?.tier ?? 'standard';

      const pol = await resolvePolicy(tx, tier, body.severity);
      const queue = await tx
        .selectFrom('queue')
        .select('id')
        .where('key', '=', 'l1')
        .executeTakeFirst();
      const phone = body.channel === 'phone' || body.callStartedAt !== undefined;
      if (phone && !p.isInternal)
        throw unprocessable('channel', 'Only WatchDog staff log cases from phone calls');
      let now = new Date();
      if (body.callStartedAt) {
        const at = new Date(body.callStartedAt);
        if (at.getTime() > now.getTime() + 60_000 || now.getTime() - at.getTime() > 24 * 3600_000)
          throw unprocessable('call-time', 'The call time must be within the last 24 hours');
        now = at;
      }
      const descriptionHtml = textToHtml(body.description);

      const c = await tx
        .insertInto('support_case')
        .values({
          org_id: orgId,
          requester_id: requesterId,
          created_by: p.userId,
          asset_id: asset.id,
          entitlement_id: best?.id ?? null,
          tier,
          severity: body.severity,
          category: body.category,
          subject: body.subject,
          description_html: descriptionHtml,
          steps_tried: body.stepsTried ?? null,
          business_impact: body.businessImpact ?? null,
          software_version: body.softwareVersion ?? asset.current_version,
          queue_id: queue?.id ?? null,
          sla_policy_id: pol?.policyId ?? null,
          opened_at: now,
          channel: phone ? 'phone' : p.apiKeyId ? 'api' : 'web',
        })
        .returning(['id', 'number'])
        .executeTakeFirstOrThrow();

      const msg = await tx
        .insertInto('case_message')
        .values({
          case_id: c.id,
          author_id: requesterId,
          author_is_staff: false,
          visibility: 'public',
          body_html: descriptionHtml,
          source: phone ? 'phone' : 'web',
          created_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.bindUploads(tx, p, c.id, msg.id, body.uploadIds, 'public');
      if (pol)
        await startClocks(tx, c.id, now, pol, body.severity === 'P1' || body.severity === 'P2');
      await this.event(tx, c.id, 'created', p.userId, {
        severity: body.severity,
        tier,
        onBehalf: p.userId !== requesterId,
        ...(phone ? { channel: 'phone' } : {}),
      });
      // Routing rules may set the queue and assign the least busy engineer straight away.
      await sql`SELECT * FROM wd.route_case(${c.id}::uuid)`.execute(tx);
      await emit(tx, 'case.created', orgId, {
        caseId: c.id,
        number: c.number,
        severity: body.severity,
      });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'case.create',
          orgId,
          targetType: 'case',
          targetId: c.id,
          diff: { severity: body.severity, tier },
        },
      );
      return c;
    });
  }

  private async targetOrg(
    tx: Tx,
    p: Principal,
    body: CreateCaseRequest,
  ): Promise<{ orgId: string; requesterId: string }> {
    if (p.isInternal) {
      if (!has(p, 'case:create:on_behalf')) throw forbidden();
      if (!body.orgId || !body.requesterId)
        throw unprocessable('on-behalf', 'Choose the customer organisation and contact');
      const r = await tx
        .selectFrom('app_user')
        .select('id')
        .where('id', '=', body.requesterId)
        .where('org_id', '=', body.orgId)
        .where('status', '!=', 'disabled')
        .executeTakeFirst();
      if (!r) throw unprocessable('on-behalf', 'That contact does not belong to the organisation');
      return { orgId: body.orgId, requesterId: r.id };
    }
    if (!has(p, 'case:create')) throw forbidden();
    const orgId = body.orgId ?? p.orgId;
    if (orgId !== p.orgId && !p.delegatedOrgIds.includes(orgId)) throw notFound('Organisation');
    return { orgId, requesterId: p.userId };
  }

  // ------------------------------------------------------------------ list
  async list(
    p: Principal,
    q: CaseListQuery,
  ): Promise<{ items: CaseSummary[]; nextCursor: string | null }> {
    return this.db.withTenant(p, async (tx) => {
      let qb = tx
        .selectFrom('support_case as c')
        .innerJoin('organization as o', 'o.id', 'c.org_id')
        .leftJoin('asset as a', 'a.id', 'c.asset_id')
        .leftJoin('product as pr', 'pr.id', 'a.product_id')
        .select([
          'c.id',
          'c.number',
          'c.subject',
          'c.severity',
          'c.category',
          'c.status',
          'c.support_level',
          'c.org_id',
          'o.name as org_name',
          'c.requester_id',
          'c.assignee_id',
          'a.serial_number',
          'pr.model_name',
          'c.opened_at',
          'c.updated_at',
        ]);

      // Inner wall (RLS is the outer one): narrow to what this principal may read.
      if (!has(p, 'case:read:all')) {
        qb = qb.where((eb) => {
          const ors = [eb('c.requester_id', '=', p.userId)];
          if (has(p, 'case:read:org')) ors.push(eb('c.org_id', '=', p.orgId));
          if (has(p, 'case:read:delegated') && p.delegatedOrgIds.length)
            ors.push(eb('c.org_id', 'in', p.delegatedOrgIds));
          return eb.or(ors);
        });
      }
      if (q.scope === 'mine') qb = qb.where('c.requester_id', '=', p.userId);
      if (q.scope === 'assigned') qb = qb.where('c.assignee_id', '=', p.userId);
      if (q.scope === 'queue') qb = qb.where('c.assignee_id', 'is', null);
      if (q.scope === 'org' && !p.isInternal) qb = qb.where('c.org_id', '=', p.orgId);
      if (q.status === 'open') qb = qb.where('c.status', 'in', [...OPEN_STATUSES]);
      if (q.status === 'closed') qb = qb.where('c.status', 'in', ['resolved', 'closed']);
      if (q.severity) qb = qb.where('c.severity', '=', q.severity);
      if (q.q) {
        const term = q.q;
        qb = qb.where((eb) =>
          eb.or([
            sql<boolean>`c.search_vec @@ plainto_tsquery('simple', ${term})`,
            eb('c.subject', 'ilike', `%${term.replace(/[%_\\]/g, '\\$&')}%`),
          ]),
        );
      }
      if (q.cursor) {
        const [at, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
        if (at && id)
          qb = qb.where(sql<boolean>`(c.opened_at, c.id) < (${new Date(at)}, ${id}::uuid)`);
      }
      const rows = await qb
        .orderBy('c.opened_at', 'desc')
        .orderBy('c.id', 'desc')
        .limit(q.limit + 1)
        .execute();
      const page = rows.slice(0, q.limit);
      const names = await this.names(
        tx,
        page.flatMap((r) => [r.requester_id, r.assignee_id]),
      );
      const clocks = page.length
        ? await tx
            .selectFrom('sla_clock')
            .selectAll()
            .where(
              'case_id',
              'in',
              page.map((r) => r.id),
            )
            .where('met_at', 'is', null)
            .execute()
        : [];
      const now = new Date();
      const items: CaseSummary[] = page.map((r) => ({
        id: r.id,
        number: r.number,
        subject: r.subject,
        severity: r.severity,
        category: r.category as CaseSummary['category'],
        status: r.status as CaseStatus,
        supportLevel: r.support_level,
        orgId: r.org_id,
        orgName: r.org_name,
        requesterName: names.get(r.requester_id)?.name ?? 'Customer contact',
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_id
          ? (names.get(r.assignee_id)?.name ?? 'WatchDog engineer')
          : null,
        serialNumber: r.serial_number,
        modelName: r.model_name,
        openedAt: r.opened_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        nextSla: OPEN_STATUSES.includes(r.status as CaseStatus)
          ? nextClock(clocks.filter((c) => c.case_id === r.id).map((c) => toView(c, now)))
          : null,
      }));
      const last = page[page.length - 1];
      return {
        items,
        nextCursor:
          rows.length > q.limit && last
            ? Buffer.from(`${last.opened_at.toISOString()}|${last.id}`).toString('base64url')
            : null,
      };
    });
  }

  // ------------------------------------------------------------------ detail
  async get(p: Principal, ref: string): Promise<CaseDetail> {
    return this.db.withTenant(p, (tx) => this.detail(tx, p, ref));
  }

  private async detail(tx: Tx, p: Principal, ref: string): Promise<CaseDetail> {
    const c = await tx
      .selectFrom('support_case as c')
      .innerJoin('organization as o', 'o.id', 'c.org_id')
      .leftJoin('asset as a', 'a.id', 'c.asset_id')
      .leftJoin('product as pr', 'pr.id', 'a.product_id')
      .selectAll('c')
      .select(['o.name as org_name', 'a.serial_number', 'pr.model_name'])
      .where(
        /^WD-/i.test(ref) ? 'c.number' : 'c.id',
        '=',
        /^WD-/i.test(ref)
          ? ref.toUpperCase()
          : isUuid(ref)
            ? ref
            : '00000000-0000-0000-0000-000000000000',
      )
      .executeTakeFirst();
    if (!c || !p.ability.can('read', asCase({ orgId: c.org_id, requesterId: c.requester_id })))
      throw notFound('Case');
    const subject = asCase({ orgId: c.org_id, requesterId: c.requester_id });

    const [messages, atts, events, clocks, csat] = await Promise.all([
      tx
        .selectFrom('case_message')
        .selectAll()
        .where('case_id', '=', c.id)
        .orderBy('created_at')
        .execute(),
      tx
        .selectFrom('case_attachment')
        .selectAll()
        .where('case_id', '=', c.id)
        .orderBy('created_at')
        .execute(),
      tx.selectFrom('case_event').selectAll().where('case_id', '=', c.id).orderBy('at').execute(),
      tx.selectFrom('sla_clock').selectAll().where('case_id', '=', c.id).execute(),
      tx
        .selectFrom('csat_response')
        .select(['score', 'comment'])
        .where('case_id', '=', c.id)
        .executeTakeFirst(),
    ]);
    const names = await this.names(tx, [
      c.requester_id,
      c.assignee_id,
      ...messages.map((m) => m.author_id),
      ...events.map((e) => e.actor_id),
    ]);
    const now = new Date();
    const sla = sortClocks(clocks.map((k) => toView(k, now)));
    const status = c.status as CaseStatus;
    const open = OPEN_STATUSES.includes(status);
    const staff = p.ability.can('transition_staff', subject);
    const customer = p.ability.can('transition_customer', subject);

    return {
      id: c.id,
      number: c.number,
      subject: c.subject,
      severity: c.severity,
      category: c.category as CaseDetail['category'],
      status,
      supportLevel: c.support_level,
      orgId: c.org_id,
      orgName: c.org_name,
      requesterName: names.get(c.requester_id)?.name ?? 'Customer contact',
      assigneeId: c.assignee_id,
      assigneeName: c.assignee_id ? (names.get(c.assignee_id)?.name ?? 'WatchDog engineer') : null,
      serialNumber: c.serial_number,
      modelName: c.model_name,
      openedAt: c.opened_at.toISOString(),
      updatedAt: c.updated_at.toISOString(),
      nextSla: open ? nextClock(sla) : null,
      channel: c.channel,
      description: c.description_html,
      stepsTried: c.steps_tried,
      businessImpact: c.business_impact,
      softwareVersion: c.software_version,
      tier: c.tier as CaseDetail['tier'],
      sla,
      messages: messages.map((m) => ({
        id: m.id,
        author: {
          id: m.author_id,
          name: m.author_id
            ? (names.get(m.author_id)?.name ?? 'WatchDog Support')
            : 'WatchDog Support',
          isStaff: m.author_is_staff,
        },
        visibility: m.visibility,
        bodyHtml: m.body_html,
        source: m.source,
        createdAt: m.created_at.toISOString(),
        attachments: atts
          .filter((a) => a.message_id === m.id)
          .map((a) => ({
            id: a.id,
            fileName: a.file_name,
            sizeBytes: Number(a.size_bytes),
            sha256: a.sha256,
            scanStatus: a.scan_status,
            secretsMasked: a.secrets_masked,
            maskedCount: a.masked_count,
            visibility: a.visibility,
            createdAt: a.created_at.toISOString(),
          })),
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        data: e.data as Record<string, unknown>,
        actorName: e.actor_id ? (names.get(e.actor_id)?.name ?? null) : null,
        at: e.at.toISOString(),
      })),
      csat: csat ? { score: csat.score, comment: csat.comment } : null,
      version: c.version,
      allowedTransitions: staff
        ? [...STAFF_TRANSITIONS[status]]
        : customer
          ? this.customerTransitions(c)
          : [],
      can: {
        reply: status !== 'closed' && p.ability.can('reply', subject),
        internalNote: p.ability.can('note', subject),
        escalate: open && c.support_level < 4 && p.ability.can('escalate_level', subject),
        customerEscalate:
          open && !c.customer_escalated_at && p.ability.can('escalate_customer', subject),
        assign: p.ability.can('assign', subject),
        submitCsat:
          !csat && (status === 'resolved' || status === 'closed') && p.ability.can('csat', subject),
      },
    };
  }

  private customerTransitions(c: { status: string; closed_at: Date | null }): CaseStatus[] {
    const list = [...CUSTOMER_TRANSITIONS[c.status as CaseStatus]];
    if (
      c.status === 'closed' &&
      (!c.closed_at || Date.now() - c.closed_at.getTime() > REOPEN_WINDOW_DAYS * 86_400_000)
    )
      return [];
    return list;
  }

  // ------------------------------------------------------------------ messages
  async reply(
    p: Principal,
    ctx: RequestContext,
    ref: string,
    body: ReplyRequest,
  ): Promise<CaseDetail> {
    return this.db.withTenant(p, async (tx) => {
      const c = await this.lockCase(tx, p, ref);
      const subject = asCase({ orgId: c.org_id, requesterId: c.requester_id });
      const internal = body.visibility === 'internal';
      if (internal ? !p.ability.can('note', subject) : !p.ability.can('reply', subject))
        throw forbidden();
      if (c.status === 'closed')
        throw conflict(
          'case-closed',
          'This case is closed',
          'Reopen the case to continue the conversation.',
        );
      const staff = p.isInternal;
      const now = new Date();

      const msg = await tx
        .insertInto('case_message')
        .values({
          case_id: c.id,
          author_id: p.userId,
          author_is_staff: staff,
          visibility: body.visibility,
          body_html: textToHtml(body.body),
          source: 'web',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.bindUploads(tx, p, c.id, msg.id, body.uploadIds, body.visibility);

      let status = c.status as CaseStatus;
      if (!internal && staff) {
        await tx
          .updateTable('support_case')
          .set({ first_responded_at: sql`coalesce(first_responded_at, ${now})` })
          .where('id', '=', c.id)
          .execute();
        await markMet(tx, c.id, ['first_response'], now);
        const pol = await this.policyFor(tx, c);
        if (pol && status !== 'resolved') await rearmUpdateClock(tx, c.id, now, pol);
      }
      if (!internal && !staff) {
        // Customer replies automatically move the case back to the engineer.
        if (status === 'awaiting_customer')
          status = await this.applyTransition(tx, p, c, 'in_progress', 'staff', now, {
            auto: true,
          });
        else if (status === 'resolved')
          status = await this.applyTransition(tx, p, c, 'reopened', 'customer', now, {
            auto: true,
          });
      }
      if (body.setStatus && body.setStatus !== status) {
        if (!staff) throw forbidden('Only WatchDog engineers can change status with a reply');
        await this.applyTransition(tx, p, { ...c, status }, body.setStatus, 'staff', now, {});
      }
      await tx
        .updateTable('support_case')
        .set({ version: sql`version + 1` })
        .where('id', '=', c.id)
        .execute();
      if (!internal)
        await emit(tx, 'case.message.public_created', c.org_id, {
          caseId: c.id,
          number: c.number,
          messageId: msg.id,
          byStaff: staff,
        });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: internal ? 'case.note' : 'case.reply',
          orgId: c.org_id,
          targetType: 'case',
          targetId: c.id,
        },
      );
      return this.detail(tx, p, c.id);
    });
  }

  // ------------------------------------------------------------------ status
  async transition(
    p: Principal,
    ctx: RequestContext,
    ref: string,
    to: CaseStatus,
    note: string | undefined,
    ifMatch?: number,
  ): Promise<CaseDetail> {
    return this.db.withTenant(p, async (tx) => {
      const c = await this.lockCase(tx, p, ref);
      if (ifMatch !== undefined && ifMatch !== c.version)
        throw new ProblemError(
          412,
          'stale',
          'This case was updated by someone else',
          'Reload to see the latest changes.',
        );
      const subject = asCase({ orgId: c.org_id, requesterId: c.requester_id });
      const actor: Actor | null = p.ability.can('transition_staff', subject)
        ? 'staff'
        : p.ability.can('transition_customer', subject)
          ? 'customer'
          : null;
      if (!actor) throw forbidden();
      if (actor === 'customer' && !this.customerTransitions(c).includes(to)) {
        // A staff-only move is an authorization failure; an impossible move is a conflict.
        if (STAFF_TRANSITIONS[c.status as CaseStatus].includes(to))
          throw forbidden('Only WatchDog engineers can make this change');
        throw conflict('invalid-transition', `A case cannot move from ${c.status} to ${to}`);
      }
      await this.applyTransition(tx, p, c, to, actor, new Date(), { note });
      if (note) {
        await tx
          .insertInto('case_message')
          .values({
            case_id: c.id,
            author_id: p.userId,
            author_is_staff: p.isInternal,
            visibility: 'public',
            body_html: textToHtml(note),
            source: 'web',
          })
          .execute();
      }
      await tx
        .updateTable('support_case')
        .set({ version: sql`version + 1` })
        .where('id', '=', c.id)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'case.transition',
          orgId: c.org_id,
          targetType: 'case',
          targetId: c.id,
          diff: { from: c.status, to },
        },
      );
      return this.detail(tx, p, c.id);
    });
  }

  /** Single place where status changes and their SLA side effects happen (design §6.3). */
  private async applyTransition(
    tx: Tx,
    p: Principal,
    c: CaseRow,
    to: CaseStatus,
    actor: Actor,
    now: Date,
    opts: { note?: string; auto?: boolean },
  ): Promise<CaseStatus> {
    const from = c.status as CaseStatus;
    if (!canTransition(from, to, actor))
      throw conflict('invalid-transition', `A case cannot move from ${from} to ${to}`);
    const set: Record<string, unknown> = { status: to };
    if (from === 'awaiting_customer') await resumeAll(tx, c.id, now);
    if (to === 'awaiting_customer') await pauseAll(tx, c.id, now);
    if (to === 'workaround_provided') await markMet(tx, c.id, ['restoration'], now);
    if (to === 'resolved') {
      set.resolved_at = now;
      await markMet(tx, c.id, ['first_response', 'restoration', 'resolution', 'update'], now);
    }
    if (to === 'closed') {
      set.closed_at = now;
      await markMet(tx, c.id, ['first_response', 'restoration', 'resolution', 'update'], now);
    }
    if (to === 'reopened') {
      set.resolved_at = null;
      set.closed_at = null;
      await unmet(tx, c.id, ['resolution']); // policy: continue the original resolution budget
    }
    await tx.updateTable('support_case').set(set).where('id', '=', c.id).execute();
    await this.event(tx, c.id, 'status_changed', p.userId, { from, to, auto: opts.auto ?? false });
    await emit(tx, 'case.status_changed', c.org_id, {
      caseId: c.id,
      number: c.number,
      from,
      to,
      byStaff: p.isInternal,
    });
    c.status = to;
    return to;
  }

  // ------------------------------------------------------------------ escalation / assignment / CSAT
  async escalate(
    p: Principal,
    ctx: RequestContext,
    ref: string,
    justification: string,
  ): Promise<CaseDetail> {
    return this.db.withTenant(p, async (tx) => {
      const c = await this.lockCase(tx, p, ref);
      const subject = asCase({ orgId: c.org_id, requesterId: c.requester_id });
      if (!OPEN_STATUSES.includes(c.status as CaseStatus))
        throw conflict('not-open', 'Only open cases can be escalated');
      if (p.ability.can('escalate_level', subject)) {
        if (c.support_level >= 4)
          throw conflict('max-level', 'This case is already with Engineering');
        const level = c.support_level + 1;
        const queue = await tx
          .selectFrom('queue')
          .select('id')
          .where('support_level', '=', level)
          .executeTakeFirst();
        await tx
          .updateTable('support_case')
          .set({
            support_level: level,
            queue_id: queue?.id ?? null,
            assignee_id: null,
            version: sql`version + 1`,
          })
          .where('id', '=', c.id)
          .execute();
        await this.event(tx, c.id, 'escalated', p.userId, {
          fromLevel: c.support_level,
          toLevel: level,
        });
        await tx
          .insertInto('case_message')
          .values({
            case_id: c.id,
            author_id: p.userId,
            author_is_staff: true,
            visibility: 'internal',
            body_html: textToHtml(`Escalated to ${levelName(level)}: ${justification}`),
            source: 'web',
          })
          .execute();
        await emit(tx, 'case.escalated', c.org_id, { caseId: c.id, number: c.number, level });
      } else if (p.ability.can('escalate_customer', subject)) {
        if (c.customer_escalated_at)
          throw conflict(
            'already-escalated',
            'This case has already been escalated to WatchDog management',
          );
        await tx
          .updateTable('support_case')
          .set({ customer_escalated_at: new Date(), version: sql`version + 1` })
          .where('id', '=', c.id)
          .execute();
        await tx
          .insertInto('case_message')
          .values({
            case_id: c.id,
            author_id: p.userId,
            author_is_staff: false,
            visibility: 'public',
            body_html: textToHtml(`Escalation requested:\n\n${justification}`),
            source: 'web',
          })
          .execute();
        await this.event(tx, c.id, 'customer_escalated', p.userId, {});
        await emit(tx, 'case.customer_escalated', c.org_id, { caseId: c.id, number: c.number });
      } else {
        throw forbidden();
      }
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'case.escalate', orgId: c.org_id, targetType: 'case', targetId: c.id },
      );
      return this.detail(tx, p, c.id);
    });
  }

  async assign(
    p: Principal,
    ctx: RequestContext,
    ref: string,
    assigneeId: string | null,
  ): Promise<CaseDetail> {
    return this.db.withTenant(p, async (tx) => {
      const c = await this.lockCase(tx, p, ref);
      if (!p.ability.can('assign', asCase({ orgId: c.org_id, requesterId: c.requester_id })))
        throw forbidden();
      if (assigneeId) {
        const ok = await tx
          .selectFrom('user_role as ur')
          .innerJoin('app_user as u', 'u.id', 'ur.user_id')
          .select('u.id')
          .where('u.id', '=', assigneeId)
          .where('u.status', '=', 'active')
          .where('ur.role_key', 'in', [
            'l1_engineer',
            'l2_engineer',
            'l3_engineer',
            'support_manager',
          ])
          .executeTakeFirst();
        if (!ok)
          throw unprocessable('assignee', 'Cases can only be assigned to active support engineers');
      }
      await tx
        .updateTable('support_case')
        .set({ assignee_id: assigneeId, version: sql`version + 1` })
        .where('id', '=', c.id)
        .execute();
      await tx
        .insertInto('case_event')
        .values({
          case_id: c.id,
          type: 'assigned',
          visibility: 'internal',
          actor_id: p.userId,
          data: JSON.stringify({ assigneeId }),
        } as never)
        .execute();
      if (c.status === 'new')
        await this.applyTransition(tx, p, c, 'triage', 'staff', new Date(), { auto: true });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'case.assign',
          orgId: c.org_id,
          targetType: 'case',
          targetId: c.id,
          diff: { assigneeId },
        },
      );
      return this.detail(tx, p, c.id);
    });
  }

  async csat(
    p: Principal,
    ctx: RequestContext,
    ref: string,
    body: CsatRequest,
  ): Promise<CaseDetail> {
    return this.db.withTenant(p, async (tx) => {
      const c = await this.lockCase(tx, p, ref);
      if (!p.ability.can('csat', asCase({ orgId: c.org_id, requesterId: c.requester_id })))
        throw forbidden();
      await this.insertCsat(tx, c, p.userId, body);
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'case.csat',
          orgId: c.org_id,
          targetType: 'case',
          targetId: c.id,
          diff: { score: body.score },
        },
      );
      return this.detail(tx, p, c.id);
    });
  }

  /** Tokenised CSAT from the resolution email (no login needed). Token binds case + user. */
  async csatByToken(caseId: string, userId: string, body: CsatRequest): Promise<void> {
    await this.db.withSystem(async (tx) => {
      const c = await tx
        .selectFrom('support_case')
        .select(['id', 'org_id', 'status', 'requester_id'])
        .where('id', '=', caseId)
        .executeTakeFirst();
      if (!c || c.requester_id !== userId) throw notFound('Case');
      await this.insertCsat(tx, c, userId, body);
    });
  }

  private async insertCsat(
    tx: Tx,
    c: { id: string; org_id: string; status: string },
    userId: string,
    body: CsatRequest,
  ) {
    if (c.status !== 'resolved' && c.status !== 'closed')
      throw conflict('not-resolved', 'Feedback can be given once the case is resolved');
    const exists = await tx
      .selectFrom('csat_response')
      .select('id')
      .where('case_id', '=', c.id)
      .executeTakeFirst();
    if (exists) throw conflict('csat-exists', 'Feedback was already submitted for this case');
    await tx
      .insertInto('csat_response')
      .values({
        case_id: c.id,
        user_id: userId,
        score: body.score,
        comment: body.comment ?? null,
        followup_status: body.score <= 2 ? 'needed' : null,
      })
      .execute();
    await this.event(tx, c.id, 'csat_submitted', userId, { score: body.score });
    // A poor rating asks a support manager to call the customer back.
    if (body.score <= 2) await emit(tx, 'csat.low', c.org_id, { caseId: c.id, score: body.score });
  }

  // ------------------------------------------------------------------ helpers
  private async lockCase(tx: Tx, p: Principal, ref: string): Promise<CaseRow> {
    const c = await tx
      .selectFrom('support_case')
      .select([
        'id',
        'org_id',
        'number',
        'requester_id',
        'status',
        'severity',
        'tier',
        'support_level',
        'closed_at',
        'customer_escalated_at',
        'version',
      ])
      .where(
        /^WD-/i.test(ref) ? 'number' : 'id',
        '=',
        /^WD-/i.test(ref)
          ? ref.toUpperCase()
          : isUuid(ref)
            ? ref
            : '00000000-0000-0000-0000-000000000000',
      )
      .forUpdate()
      .executeTakeFirst();
    if (!c || !p.ability.can('read', asCase({ orgId: c.org_id, requesterId: c.requester_id })))
      throw notFound('Case');
    return c;
  }

  private async policyFor(tx: Tx, c: CaseRow): Promise<ResolvedPolicy | null> {
    return resolvePolicy(tx, c.tier ?? 'standard', c.severity);
  }

  private async bindUploads(
    tx: Tx,
    p: Principal,
    caseId: string,
    messageId: string,
    ids: string[],
    visibility: 'public' | 'internal',
  ) {
    if (!ids.length) return;
    const uploads = await tx
      .selectFrom('upload')
      .selectAll()
      .where('id', 'in', ids)
      .where('user_id', '=', p.userId)
      .where('completed', '=', true)
      .where('bound_at', 'is', null)
      .execute();
    if (uploads.length !== new Set(ids).size)
      throw unprocessable('upload', 'One or more attachments are missing or still uploading');
    for (const u of uploads) {
      const a = await tx
        .insertInto('case_attachment')
        .values({
          case_id: caseId,
          message_id: messageId,
          upload_id: u.id,
          file_name: u.file_name,
          size_bytes: u.size_bytes,
          quarantine_key: u.id,
          visibility,
          uploaded_by: p.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.updateTable('upload').set({ bound_at: new Date() }).where('id', '=', u.id).execute();
      await emit(tx, 'attachment.scan', null, { attachmentId: a.id });
    }
  }

  private async event(
    tx: Tx,
    caseId: string,
    type: string,
    actorId: string | null,
    data: Record<string, unknown>,
  ) {
    await tx
      .insertInto('case_event')
      .values({ case_id: caseId, type, actor_id: actorId, data: JSON.stringify(data) } as never)
      .execute();
  }

  private async names(
    tx: Tx,
    ids: Array<string | null>,
  ): Promise<Map<string, { name: string; isStaff: boolean }>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map();
    const r = await sql<{
      id: string;
      display_name: string;
      is_staff: boolean;
    }>`SELECT * FROM wd.display_names(${uniq}::uuid[])`.execute(tx);
    return new Map(r.rows.map((x) => [x.id, { name: x.display_name, isStaff: x.is_staff }]));
  }
}

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const levelName = (l: number) => (l >= 4 ? 'Engineering' : `L${l}`);
