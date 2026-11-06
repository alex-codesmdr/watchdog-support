import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  BulkAssignRequest,
  PresenceRequest,
  SavedViewRequest,
  TimeEntryRequest,
  type BulkAssignResult,
  type CustomerContext,
  type Engineer,
  type Presence,
  type SavedView,
  type Severity,
  type TimeLog,
} from '@wd/contracts';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB, REDIS } from '../../tokens.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { ProblemError, forbidden, notFound } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { CasesService } from '../cases/cases.service.js';

const ENGINEER_ROLES = ['l1_engineer', 'l2_engineer', 'l3_engineer', 'support_manager'];
const PRESENCE_TTL_S = 40;
const Id = z.string().uuid();
const Ref = z.string().regex(/^WD-\d{4}-\d{6}$/i);

/** Presence store: Redis in production, a process-local map when Redis is not configured. */
class PresenceStore {
  private local = new Map<string, Map<string, { name: string; replying: boolean; at: number }>>();
  constructor(private readonly redis: Redis | null) {}

  async touch(caseId: string, userId: string, name: string, replying: boolean) {
    const now = Date.now();
    if (this.redis) {
      const k = `presence:case:${caseId}`;
      await this.redis
        .multi()
        .hset(k, userId, JSON.stringify({ name, replying, at: now }))
        .expire(k, PRESENCE_TTL_S * 3)
        .exec();
      const all = await this.redis.hgetall(k);
      return Object.entries(all)
        .map(([id, v]) => ({
          id,
          ...(JSON.parse(v) as { name: string; replying: boolean; at: number }),
        }))
        .filter((x) => now - x.at < PRESENCE_TTL_S * 1000);
    }
    const m = this.local.get(caseId) ?? new Map();
    m.set(userId, { name, replying, at: now });
    this.local.set(caseId, m);
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .filter((x) => now - x.at < PRESENCE_TTL_S * 1000);
  }
}

/**
 * Tools for engineers working the queue: bulk assignment, who else is on a case, the customer at a
 * glance, time logging and saved queue filters. Staff only (case:read:all).
 */
@Controller('api/v1/workspace')
export class WorkspaceController {
  private readonly presence: PresenceStore;
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(REDIS) redis: Redis | null,
  ) {
    this.presence = new PresenceStore(redis);
  }

  private staff(p: Principal) {
    if (!p.isInternal || p.apiKeyId) throw forbidden();
  }

  private async caseRow(tx: Tx, ref: string) {
    const c = await tx
      .selectFrom('support_case')
      .select(['id', 'org_id'])
      .where('number', '=', parse(Ref, ref).toUpperCase())
      .executeTakeFirst();
    if (!c) throw notFound('Case');
    return c;
  }

  @Get('engineers')
  @RequirePermission('case:assign')
  engineers(@CurrentPrincipal() p: Principal): Promise<{ items: Engineer[] }> {
    this.staff(p);
    return this.db.withTenant(p, async (tx) => {
      const rows = await tx
        .selectFrom('app_user as u')
        .innerJoin('user_role as ur', 'ur.user_id', 'u.id')
        .select([
          'u.id',
          'u.display_name as name',
          sql<string>`(SELECT count(*) FROM support_case c WHERE c.assignee_id = u.id AND c.status NOT IN ('resolved','closed'))`.as(
            'open',
          ),
        ])
        .where('ur.role_key', 'in', ENGINEER_ROLES)
        .where('u.status', '=', 'active')
        .groupBy(['u.id', 'u.display_name'])
        .orderBy('u.display_name')
        .execute();
      return { items: rows.map((r) => ({ id: r.id, name: r.name, openCases: Number(r.open) })) };
    });
  }

  /** Assigns up to 50 cases; each is checked and recorded exactly like a single assignment. */
  @Post('bulk-assign')
  @HttpCode(200)
  @RequirePermission('case:assign')
  @RateLimit('bulk-assign', 30, 600)
  async bulkAssign(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<BulkAssignResult> {
    this.staff(p);
    const b = parse(BulkAssignRequest, body);
    const results: BulkAssignResult['results'] = [];
    for (const number of [...new Set(b.numbers.map((n) => n.toUpperCase()))]) {
      try {
        await this.cases.assign(p, ctx, number, b.assigneeId);
        results.push({ number, ok: true, error: null });
      } catch (e) {
        results.push({
          number,
          ok: false,
          error:
            e instanceof ProblemError
              ? ((e.getResponse() as { title?: string }).title ?? 'Could not assign this case')
              : 'Could not assign this case',
        });
      }
    }
    return { results };
  }

  @Post('cases/:ref/presence')
  @HttpCode(200)
  @RequirePermission('case:read:all')
  @RateLimit('presence', 120, 60)
  async presenceTouch(
    @CurrentPrincipal() p: Principal,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ): Promise<Presence> {
    this.staff(p);
    const { replying } = parse(PresenceRequest, body ?? {});
    const { c, name } = await this.db.withTenant(p, async (tx) => ({
      c: await this.caseRow(tx, ref),
      name:
        (
          await tx
            .selectFrom('app_user')
            .select('display_name')
            .where('id', '=', p.userId)
            .executeTakeFirst()
        )?.display_name ?? 'An engineer',
    }));
    const all = await this.presence.touch(c.id, p.userId, name, replying);
    return {
      others: all
        .filter((x) => x.id !== p.userId)
        .map((x) => ({ name: x.name, replying: x.replying })),
    };
  }

  @Get('cases/:ref/context')
  @RequirePermission('case:read:all')
  context(@CurrentPrincipal() p: Principal, @Param('ref') ref: string): Promise<CustomerContext> {
    this.staff(p);
    return this.db.withTenant(p, async (tx) => {
      const c = await this.caseRow(tx, ref);
      const [org, counts, recent, devices, csat] = await Promise.all([
        tx
          .selectFrom('organization')
          .select('name')
          .where('id', '=', c.org_id)
          .executeTakeFirstOrThrow(),
        tx
          .selectFrom('support_case')
          .select([
            sql<string>`count(*) FILTER (WHERE status NOT IN ('resolved','closed'))`.as('open'),
            sql<string>`count(*) FILTER (WHERE opened_at > now() - interval '90 days')`.as(
              'recent',
            ),
          ])
          .where('org_id', '=', c.org_id)
          .executeTakeFirstOrThrow(),
        tx
          .selectFrom('support_case')
          .select(['number', 'subject', 'severity', 'status', 'opened_at'])
          .where('org_id', '=', c.org_id)
          .where('id', '!=', c.id)
          .orderBy('opened_at', 'desc')
          .limit(5)
          .execute(),
        tx
          .selectFrom('asset as a')
          .select([
            sql<string>`count(*)`.as('n'),
            sql<string>`count(*) FILTER (WHERE (SELECT max(e.ends_on) FROM entitlement e WHERE e.asset_id = a.id) BETWEEN current_date AND current_date + 60)`.as(
              'ending',
            ),
          ])
          .where('a.org_id', '=', c.org_id)
          .where('a.retired_at', 'is', null)
          .executeTakeFirstOrThrow(),
        tx
          .selectFrom('csat_response')
          .select([sql<string | null>`avg(score)`.as('avg'), sql<string>`count(*)`.as('n')])
          .where('org_id', '=', c.org_id)
          .where('created_at', '>', sql<Date>`now() - interval '180 days'`)
          .executeTakeFirstOrThrow(),
      ]);
      return {
        orgName: org.name,
        openCases: Number(counts.open),
        casesLast90Days: Number(counts.recent),
        devices: Number(devices.n),
        coverageEndingSoon: Number(devices.ending),
        csatAverage: csat.avg === null ? null : Math.round(Number(csat.avg) * 10) / 10,
        csatResponses: Number(csat.n),
        recentCases: recent.map((r) => ({
          number: r.number,
          subject: r.subject,
          severity: r.severity as Severity,
          status: r.status,
          openedAt: r.opened_at.toISOString(),
        })),
      };
    });
  }

  private async timeLog(tx: Tx, p: Principal, caseId: string): Promise<TimeLog> {
    const rows = await tx
      .selectFrom('case_time_entry as t')
      .innerJoin('app_user as u', 'u.id', 't.user_id')
      .select(['t.id', 't.minutes', 't.note', 't.worked_on', 't.user_id', 'u.display_name'])
      .where('t.case_id', '=', caseId)
      .orderBy('t.created_at', 'desc')
      .limit(200)
      .execute();
    const total = await tx
      .selectFrom('case_time_entry')
      .select(sql<string>`coalesce(sum(minutes), 0)`.as('m'))
      .where('case_id', '=', caseId)
      .executeTakeFirstOrThrow();
    return {
      totalMinutes: Number(total.m),
      entries: rows.map((r) => ({
        id: r.id,
        minutes: r.minutes,
        note: r.note,
        workedOn: String(r.worked_on).slice(0, 10),
        by: r.display_name,
        mine: r.user_id === p.userId,
      })),
    };
  }

  @Get('cases/:ref/time')
  @RequirePermission('case:read:all')
  time(@CurrentPrincipal() p: Principal, @Param('ref') ref: string): Promise<TimeLog> {
    this.staff(p);
    return this.db.withTenant(p, async (tx) =>
      this.timeLog(tx, p, (await this.caseRow(tx, ref)).id),
    );
  }

  @Post('cases/:ref/time')
  @RequirePermission('case:note:internal')
  logTime(
    @CurrentPrincipal() p: Principal,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ): Promise<TimeLog> {
    this.staff(p);
    const b = parse(TimeEntryRequest, body);
    return this.db.withTenant(p, async (tx) => {
      const c = await this.caseRow(tx, ref);
      await tx
        .insertInto('case_time_entry')
        .values({
          case_id: c.id,
          user_id: p.userId,
          minutes: b.minutes,
          note: b.note,
          ...(b.workedOn ? { worked_on: b.workedOn } : {}),
        } as never)
        .execute();
      return this.timeLog(tx, p, c.id);
    });
  }

  @Delete('time/:id')
  @RequirePermission('case:note:internal')
  async deleteTime(@CurrentPrincipal() p: Principal, @Param('id') raw: string) {
    this.staff(p);
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .deleteFrom('case_time_entry')
        .where('id', '=', id)
        .returning('case_id')
        .executeTakeFirst();
      if (!r) throw notFound('Time entry');
      return this.timeLog(tx, p, r.case_id);
    });
  }

  @Get('views')
  @RequirePermission('case:read:all')
  views(@CurrentPrincipal() p: Principal): Promise<{ items: SavedView[] }> {
    this.staff(p);
    return this.db.withTenant(p, async (tx) => ({
      items: (
        await tx
          .selectFrom('saved_view')
          .select(['id', 'name', 'params'])
          .orderBy('name')
          .limit(50)
          .execute()
      ).map((r) => ({ id: r.id, name: r.name, params: r.params as SavedView['params'] })),
    }));
  }

  @Post('views')
  @RequirePermission('case:read:all')
  saveView(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<SavedView> {
    this.staff(p);
    const b = parse(SavedViewRequest, body);
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .insertInto('saved_view')
        .values({ owner_id: p.userId, name: b.name, params: JSON.stringify(b.params) })
        .onConflict((oc) =>
          oc.columns(['owner_id', 'name']).doUpdateSet({ params: JSON.stringify(b.params) }),
        )
        .returning(['id', 'name', 'params'])
        .executeTakeFirstOrThrow();
      return { id: r.id, name: r.name, params: r.params as SavedView['params'] };
    });
  }

  @Delete('views/:id')
  @HttpCode(204)
  @RequirePermission('case:read:all')
  async deleteView(@CurrentPrincipal() p: Principal, @Param('id') raw: string) {
    this.staff(p);
    const id = parse(Id, raw);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx.deleteFrom('saved_view').where('id', '=', id).executeTakeFirst();
      if (!r.numDeletedRows) throw notFound('Saved view');
    });
  }
}
