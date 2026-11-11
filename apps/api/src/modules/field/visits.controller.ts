import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { VisitBook, VisitCancel, VisitKind, type VisitSlots, type VisitView } from '@wd/contracts';
import { asCase } from '@wd/rbac';
import type { Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const Ref = z.string().regex(/^WD-\d{4}-\d{6}$/i);
const OPEN = [
  'new',
  'triage',
  'in_progress',
  'awaiting_customer',
  'awaiting_vendor',
  'workaround_provided',
  'reopened',
];

/** Slot grid in India time: on-site visits are two hours, remote sessions one hour. */
const GRID: Record<VisitKind, { starts: number[]; hours: number; leadHours: number }> = {
  onsite: { starts: [10, 12, 14, 16], hours: 2, leadHours: 18 },
  remote: { starts: [10, 11, 12, 13, 14, 15, 16, 17], hours: 1, leadHours: 2 },
};
const DAYS_AHEAD = 10;
const istDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const at = (day: string, hour: number) =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+05:30`);

/**
 * Book an engineer visit or a remote session from a case. Free slots come from the roster: an
 * engineer on shift for the whole window and not already booked. Sundays and holidays are closed.
 */
@Controller('api/v1')
export class VisitsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async readableCase(tx: Tx, p: Principal, ref: string) {
    const c = await tx
      .selectFrom('support_case')
      .select(['id', 'org_id', 'number', 'status', 'requester_id', 'asset_id'])
      .where('number', '=', parse(Ref, ref).toUpperCase())
      .executeTakeFirst();
    if (!c || !p.ability.can('read', asCase({ orgId: c.org_id, requesterId: c.requester_id })))
      throw notFound('Case');
    return c;
  }

  /** Candidate windows from now on, minus Sundays and holidays. */
  private async windows(tx: Tx, kind: VisitKind, now = new Date()) {
    const g = GRID[kind];
    const first = istDay(now);
    const days = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => {
      const d = new Date(`${first}T12:00:00+05:30`);
      d.setUTCDate(d.getUTCDate() + i);
      return istDay(d);
    });
    const hol = await sql<{ day: string }>`
      SELECT to_char(h.day, 'YYYY-MM-DD') AS day FROM calendar_holiday h
        JOIN business_calendar c ON c.id = h.calendar_id AND c.key = 'ist-business'
       WHERE h.day BETWEEN ${days[0]}::date AND ${days[days.length - 1]}::date`.execute(tx);
    const closed = new Set(hol.rows.map((h) => h.day));
    const earliest = now.getTime() + g.leadHours * 3600_000;
    return days
      .filter((d) => !closed.has(d) && new Date(`${d}T12:00:00+05:30`).getUTCDay() !== 0)
      .map((day) => ({
        day,
        slots: g.starts
          .map((h) => ({ startsAt: at(day, h), endsAt: at(day, h + g.hours) }))
          .filter((s) => s.startsAt.getTime() >= earliest),
      }));
  }

  private async free(tx: Tx, s: Date, e: Date): Promise<string[]> {
    const r = await sql<{
      engineer_id: string;
    }>`SELECT engineer_id FROM wd.free_engineers(${s}, ${e})`.execute(tx);
    return r.rows.map((x) => x.engineer_id);
  }

  @Get('cases/:ref/visit-slots')
  @RequirePermission('visit:book')
  async slots(
    @CurrentPrincipal() p: Principal,
    @Param('ref') ref: string,
    @Query('kind') rawKind?: string,
  ): Promise<VisitSlots> {
    const kind = parse(VisitKind, rawKind ?? 'onsite');
    return this.db.withTenant(p, async (tx) => {
      const c = await this.readableCase(tx, p, ref);
      if (!OPEN.includes(c.status)) return { kind, days: [] };
      const days = [];
      for (const d of await this.windows(tx, kind)) {
        const slots = [];
        for (const s of d.slots)
          if ((await this.free(tx, s.startsAt, s.endsAt)).length)
            slots.push({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() });
        if (slots.length) days.push({ day: d.day, slots });
      }
      return { kind, days };
    });
  }

  private async views(
    tx: Tx,
    where: { caseId?: string; id?: string; from?: Date },
  ): Promise<VisitView[]> {
    let q = tx
      .selectFrom('visit as v')
      .innerJoin('support_case as c', 'c.id', 'v.case_id')
      .innerJoin('organization as o', 'o.id', 'v.org_id')
      .leftJoin('site as s', 's.id', 'v.site_id')
      .select([
        'v.id',
        'c.number',
        'o.name as org_name',
        'v.kind',
        'v.starts_at',
        'v.ends_at',
        'v.engineer_id',
        's.name as site_name',
        'v.contact_name',
        'v.contact_phone',
        'v.notes',
        'v.status',
        'v.cancel_reason',
        sql<string | null>`wd.public_name(v.engineer_id)`.as('eng'),
      ]);
    if (where.caseId) q = q.where('v.case_id', '=', where.caseId);
    if (where.id) q = q.where('v.id', '=', where.id);
    if (where.from) q = q.where('v.ends_at', '>=', where.from).where('v.status', '=', 'booked');
    const rows = await q.orderBy('v.starts_at').limit(300).execute();
    return rows.map((r) => ({
      id: r.id,
      caseNumber: r.number,
      orgName: r.org_name,
      kind: r.kind,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      engineerName: r.eng,
      siteName: r.site_name,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      notes: r.notes,
      status: r.status,
      cancelReason: r.cancel_reason,
    }));
  }

  @Get('cases/:ref/visits')
  @RequirePermission('visit:book', 'visit:manage')
  async forCase(
    @CurrentPrincipal() p: Principal,
    @Param('ref') ref: string,
  ): Promise<{ items: VisitView[] }> {
    return this.db.withTenant(p, async (tx) => {
      const c = await this.readableCase(tx, p, ref);
      return { items: await this.views(tx, { caseId: c.id }) };
    });
  }

  @Post('cases/:ref/visits')
  @RequirePermission('visit:book')
  @RateLimit('visit-book', 20, 3600)
  async book(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ): Promise<{ items: VisitView[] }> {
    const b = parse(VisitBook, body);
    return this.db.withTenant(p, async (tx) => {
      const c = await this.readableCase(tx, p, ref);
      if (!OPEN.includes(c.status))
        throw conflict('case-closed', 'Visits can be booked for open cases only');
      const start = new Date(b.startsAt);
      const slot = (await this.windows(tx, b.kind))
        .flatMap((d) => d.slots)
        .find((s) => s.startsAt.getTime() === start.getTime());
      if (!slot) throw unprocessable('startsAt', 'Choose one of the offered times');
      if (b.kind === 'onsite') {
        if (!b.siteId) throw unprocessable('siteId', 'Choose the site the engineer should visit');
        const site = await tx
          .selectFrom('site')
          .select('id')
          .where('id', '=', b.siteId)
          .where('org_id', '=', c.org_id)
          .executeTakeFirst();
        if (!site) throw unprocessable('siteId', 'Choose one of your sites');
      }
      const open = await tx
        .selectFrom('visit')
        .select('id')
        .where('case_id', '=', c.id)
        .where('status', '=', 'booked')
        .where('ends_at', '>', new Date())
        .executeTakeFirst();
      if (open)
        throw conflict(
          'visit-booked',
          'This case already has a visit booked. Cancel it first to choose another time.',
        );
      const free = await this.free(tx, slot.startsAt, slot.endsAt);
      if (!free.length)
        throw conflict('slot-taken', 'That time has just been taken. Choose another.');
      // The engineer with the fewest visits that day goes.
      const pick = await sql<{ id: string }>`
        SELECT e AS id FROM unnest(${free}::uuid[]) e
         ORDER BY (SELECT count(*) FROM visit v WHERE v.engineer_id = e AND v.status = 'booked'
                    AND v.starts_at::date = ${slot.startsAt}::timestamptz::date), e
         LIMIT 1`.execute(tx);
      const id = randomUUID();
      try {
        await tx
          .insertInto('visit')
          .values({
            id,
            case_id: c.id,
            org_id: c.org_id,
            kind: b.kind,
            starts_at: slot.startsAt,
            ends_at: slot.endsAt,
            engineer_id: pick.rows[0]!.id,
            site_id: b.kind === 'onsite' ? (b.siteId ?? null) : null,
            contact_name: b.contactName,
            contact_phone: b.contactPhone,
            notes: b.notes || null,
            booked_by: p.userId,
          })
          .execute();
      } catch (e) {
        if ((e as { code?: string }).code === '23P01')
          throw conflict('slot-taken', 'That time has just been taken. Choose another.');
        throw e;
      }
      await tx
        .insertInto('case_event')
        .values({
          case_id: c.id,
          type: 'visit_booked',
          actor_id: p.userId,
          visibility: 'public',
          data: { kind: b.kind, startsAt: slot.startsAt.toISOString() },
        })
        .execute();
      await emit(tx, 'visit.booked', c.org_id, { visitId: id });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'visit.book',
          orgId: c.org_id,
          targetType: 'case',
          targetId: c.id,
          diff: { kind: b.kind, startsAt: b.startsAt },
        },
      );
      return { items: await this.views(tx, { caseId: c.id }) };
    });
  }

  private async visitFor(tx: Tx, p: Principal, raw: string) {
    const v = await tx
      .selectFrom('visit as v')
      .innerJoin('support_case as c', 'c.id', 'v.case_id')
      .select(['v.id', 'v.case_id', 'v.org_id', 'v.status', 'v.starts_at', 'c.requester_id'])
      .where('v.id', '=', parse(Id, raw))
      .executeTakeFirst();
    if (!v || !p.ability.can('read', asCase({ orgId: v.org_id, requesterId: v.requester_id })))
      throw notFound('Visit');
    return v;
  }

  @Post('visits/:id/cancel')
  @RequirePermission('visit:book', 'visit:manage')
  async cancel(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<{ items: VisitView[] }> {
    const { reason } = parse(VisitCancel, body);
    return this.db.withTenant(p, async (tx) => {
      const v = await this.visitFor(tx, p, raw);
      if (v.status !== 'booked') throw conflict('visit-closed', 'This visit is no longer booked');
      await tx
        .updateTable('visit')
        .set({ status: 'cancelled', cancel_reason: reason })
        .where('id', '=', v.id)
        .execute();
      await tx
        .insertInto('case_event')
        .values({
          case_id: v.case_id,
          type: 'visit_cancelled',
          actor_id: p.userId,
          visibility: 'public',
          data: { reason },
        })
        .execute();
      await emit(tx, 'visit.cancelled', v.org_id, { visitId: v.id, byStaff: p.isInternal });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'visit.cancel',
          orgId: v.org_id,
          targetType: 'case',
          targetId: v.case_id,
          diff: { reason },
        },
      );
      return { items: await this.views(tx, { caseId: v.case_id }) };
    });
  }

  @Post('visits/:id/done')
  @RequirePermission('visit:manage')
  async done(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
  ): Promise<{ items: VisitView[] }> {
    return this.db.withTenant(p, async (tx) => {
      const v = await this.visitFor(tx, p, raw);
      if (v.status !== 'booked') throw conflict('visit-closed', 'This visit is no longer booked');
      if (v.starts_at.getTime() > Date.now())
        throw unprocessable('visit', 'A visit can be marked done once it has started');
      await tx.updateTable('visit').set({ status: 'done' }).where('id', '=', v.id).execute();
      await tx
        .insertInto('case_event')
        .values({
          case_id: v.case_id,
          type: 'visit_done',
          actor_id: p.userId,
          visibility: 'public',
          data: {},
        })
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'visit.done',
          orgId: v.org_id,
          targetType: 'case',
          targetId: v.case_id,
          diff: {},
        },
      );
      return { items: await this.views(tx, { caseId: v.case_id }) };
    });
  }

  /** Calendar file for the visit, for Outlook or Google Calendar. */
  @Get('visits/:id/calendar.ics')
  @RequirePermission('visit:book', 'visit:manage')
  async ics(@CurrentPrincipal() p: Principal, @Param('id') raw: string, @Res() res: Response) {
    const v = await this.db.withTenant(p, async (tx) => {
      const x = await this.visitFor(tx, p, raw);
      return (await this.views(tx, { id: x.id }))[0]!;
    });
    const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');
    const what = v.kind === 'onsite' ? 'WatchDog engineer visit' : 'WatchDog remote session';
    const body = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//WatchDog Support//Visits//EN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${v.id}@watchdog-support`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(v.startsAt)}`,
      `DTEND:${stamp(v.endsAt)}`,
      `SUMMARY:${esc(`${what} – case ${v.caseNumber}`)}`,
      `DESCRIPTION:${esc(`Engineer: ${v.engineerName ?? 'to be confirmed'}. Contact: ${v.contactName}, ${v.contactPhone}.`)}`,
      ...(v.siteName ? [`LOCATION:${esc(v.siteName)}`] : []),
      `STATUS:${v.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    res
      .status(200)
      .setHeader('content-type', 'text/calendar; charset=utf-8')
      .setHeader('content-disposition', `attachment; filename="visit-${v.caseNumber}.ics"`)
      .send(body);
  }

  @Get('workspace/visits')
  @RequirePermission('visit:manage')
  async upcoming(@CurrentPrincipal() p: Principal): Promise<{ items: VisitView[] }> {
    if (!p.isInternal || !has(p, 'case:read:all')) throw forbidden();
    const from = new Date(Date.now() - 12 * 3600_000);
    return { items: await this.db.withTenant(p, (tx) => this.views(tx, { from })) };
  }
}
