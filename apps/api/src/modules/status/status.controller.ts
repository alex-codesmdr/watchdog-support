import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import {
  IncidentCreate,
  IncidentUpdate,
  type ComponentStatus,
  type IncidentStatus,
  type StatusIncidentView,
  type StatusPage,
} from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import { notFound, unprocessable } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const SetComponent = z.object({
  status: z.enum(['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance']),
});
const SEVERITY: ComponentStatus[] = [
  'operational',
  'maintenance',
  'degraded',
  'partial_outage',
  'major_outage',
];
const DONE: IncidentStatus[] = ['resolved', 'completed'];

/** Public service status, written by support managers and system administrators. */
@Controller('api/v1')
export class StatusController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async incidents(tx: Tx, where: 'active' | 'recent'): Promise<StatusIncidentView[]> {
    let q = tx.selectFrom('status_incident').selectAll();
    q =
      where === 'active'
        ? q.where('resolved_at', 'is', null)
        : q
            .where('resolved_at', 'is not', null)
            .where('started_at', '>', sql<Date>`now() - interval '30 days'`);
    const rows = await q.orderBy('started_at', 'desc').limit(30).execute();
    if (!rows.length) return [];
    const ups = await tx
      .selectFrom('status_update')
      .select(['incident_id', 'status', 'body', 'at'])
      .where(
        'incident_id',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      impact: r.impact as StatusIncidentView['impact'],
      status: r.status as IncidentStatus,
      componentIds: r.component_ids,
      startedAt: r.started_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      updates: ups
        .filter((u) => u.incident_id === r.id)
        .map((u) => ({ status: u.status as IncidentStatus, body: u.body, at: u.at.toISOString() })),
    }));
  }

  @Public()
  @Get('public/status')
  @RateLimit('public-status', 600, 60)
  status(): Promise<StatusPage> {
    return this.db.withAnonymous(async (tx) => {
      const components = await tx
        .selectFrom('status_component')
        .select(['id', 'name', 'description', 'status', 'updated_at'])
        .orderBy('position')
        .execute();
      const overall = components.reduce<ComponentStatus>(
        (worst, c) =>
          SEVERITY.indexOf(c.status as ComponentStatus) > SEVERITY.indexOf(worst)
            ? (c.status as ComponentStatus)
            : worst,
        'operational',
      );
      const [active, recent] = await Promise.all([
        this.incidents(tx, 'active'),
        this.incidents(tx, 'recent'),
      ]);
      const latest = [
        ...components.map((c) => c.updated_at.getTime()),
        ...active.map((a) => Date.parse(a.updates[0]?.at ?? a.startedAt)),
      ];
      return {
        overall,
        components: components.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          status: c.status as ComponentStatus,
        })),
        active,
        recent,
        updatedAt: new Date(latest.length ? Math.max(...latest) : Date.now()).toISOString(),
      };
    });
  }

  @Post('admin/status/components/:id')
  @RequirePermission('status:manage')
  async setComponent(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, raw);
    const { status } = parse(SetComponent, body);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('status_component')
        .set({ status, updated_at: new Date() })
        .where('id', '=', id)
        .returning('name')
        .executeTakeFirst();
      if (!r) throw notFound('Component');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'status.component',
          orgId: null,
          targetType: 'status_component',
          targetId: id,
          diff: { name: r.name, status },
        },
      );
    });
    return this.status();
  }

  @Post('admin/status/incidents')
  @RequirePermission('status:manage')
  async open(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(IncidentCreate, body);
    assertBrandClean({ title: b.title, body: b.body });
    await this.db.withTenant(p, async (tx) => {
      const known = await tx
        .selectFrom('status_component')
        .select('id')
        .where('id', 'in', b.componentIds)
        .execute();
      if (known.length !== new Set(b.componentIds).size)
        throw unprocessable('component', 'Choose services from the list');
      const i = await tx
        .insertInto('status_incident')
        .values({
          title: b.title,
          impact: b.impact,
          status: b.status,
          component_ids: b.componentIds,
          created_by: p.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('status_update')
        .values({ incident_id: i.id, status: b.status, body: b.body, by_user: p.userId })
        .execute();
      await tx
        .updateTable('status_component')
        .set({ status: b.componentStatus, updated_at: new Date() })
        .where('id', 'in', b.componentIds)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'status.incident_open',
          orgId: null,
          targetType: 'status_incident',
          targetId: i.id,
          diff: { title: b.title },
        },
      );
    });
    return this.status();
  }

  @Post('admin/status/incidents/:id/updates')
  @RequirePermission('status:manage')
  async update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, raw);
    const b = parse(IncidentUpdate, body);
    assertBrandClean({ body: b.body });
    await this.db.withTenant(p, async (tx) => {
      const i = await tx
        .selectFrom('status_incident')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!i) throw notFound('Incident');
      if (i.resolved_at) throw unprocessable('closed', 'This incident is already closed');
      const done = DONE.includes(b.status);
      await tx
        .insertInto('status_update')
        .values({ incident_id: id, status: b.status, body: b.body, by_user: p.userId })
        .execute();
      await tx
        .updateTable('status_incident')
        .set({ status: b.status, ...(done ? { resolved_at: new Date() } : {}) })
        .where('id', '=', id)
        .execute();
      const next = done ? 'operational' : b.componentStatus;
      if (next)
        await tx
          .updateTable('status_component')
          .set({ status: next, updated_at: new Date() })
          .where(
            'id',
            'in',
            i.component_ids.length ? i.component_ids : ['00000000-0000-0000-0000-000000000000'],
          )
          .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'status.incident_update',
          orgId: null,
          targetType: 'status_incident',
          targetId: id,
          diff: { status: b.status },
        },
      );
    });
    return this.status();
  }
}
