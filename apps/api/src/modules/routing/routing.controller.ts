import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import {
  RoutingRuleRequest,
  type RoutingOptions,
  type RoutingRule,
  type CaseCategory,
  type Severity,
} from '@wd/contracts';
import { sql, type Selectable } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import type { RoutingRuleT } from '../../db/schema.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { notFound, unprocessable } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const Order = z.object({ ids: z.array(Id).min(1).max(500) });
const ENGINEER_ROLES = ['l1_engineer', 'l2_engineer', 'l3_engineer', 'support_manager'];
const MAX_RULES = 100;

const view = (r: Selectable<RoutingRuleT>): RoutingRule => ({
  id: r.id,
  name: r.name,
  position: r.position,
  enabled: r.enabled,
  severities: (r.severities ?? []) as Severity[],
  categories: (r.categories ?? []) as CaseCategory[],
  familyIds: r.family_ids ?? [],
  orgIds: r.org_ids ?? [],
  queueId: r.queue_id,
  assigneeIds: r.assignee_ids,
  updatedAt: r.updated_at.toISOString(),
});

/** Support managers decide where new cases go. Rules run in order; the first match wins. */
@Controller('api/v1/admin/routing')
export class RoutingController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('rules')
  @RequirePermission('routing:manage')
  rules(@CurrentPrincipal() p: Principal): Promise<{ items: RoutingRule[] }> {
    return this.db.withTenant(p, async (tx) => ({
      items: (
        await tx
          .selectFrom('routing_rule')
          .selectAll()
          .orderBy('position')
          .orderBy('created_at')
          .execute()
      ).map(view),
    }));
  }

  @Get('options')
  @RequirePermission('routing:manage')
  options(@CurrentPrincipal() p: Principal): Promise<RoutingOptions> {
    return this.db.withTenant(p, async (tx) => {
      const [queues, families, engineers, organizations] = await Promise.all([
        tx.selectFrom('queue').select(['id', 'name']).orderBy('support_level').execute(),
        tx.selectFrom('product_family').select(['id', 'name']).orderBy('name').execute(),
        tx
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
          .execute(),
        tx
          .selectFrom('organization')
          .select(['id', 'name'])
          .where('org_type', 'in', ['customer', 'partner'])
          .where('status', '=', 'active')
          .orderBy('name')
          .limit(1000)
          .execute(),
      ]);
      return {
        queues,
        families,
        engineers: engineers.map((e) => ({ id: e.id, name: e.name, openCases: Number(e.open) })),
        organizations,
      };
    });
  }

  private async check(tx: Tx, v: z.infer<typeof RoutingRuleRequest>) {
    if (v.assigneeIds.length) {
      const ok = await tx
        .selectFrom('app_user as u')
        .innerJoin('user_role as ur', 'ur.user_id', 'u.id')
        .select('u.id')
        .distinct()
        .where('u.id', 'in', v.assigneeIds)
        .where('ur.role_key', 'in', ENGINEER_ROLES)
        .execute();
      if (ok.length !== new Set(v.assigneeIds).size)
        throw unprocessable('assignee', 'Rules can only assign to support engineers');
    }
    if (!v.queueId && !v.assigneeIds.length)
      throw unprocessable('routing_action', 'Choose a queue, engineers, or both');
  }

  private values(v: z.infer<typeof RoutingRuleRequest>) {
    return {
      name: v.name,
      enabled: v.enabled,
      severities: v.severities,
      categories: v.categories,
      family_ids: v.familyIds,
      org_ids: v.orgIds,
      queue_id: v.queueId,
      assignee_ids: [...new Set(v.assigneeIds)],
    };
  }

  @Post('rules')
  @RequirePermission('routing:manage')
  create(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const v = parse(RoutingRuleRequest, body);
    return this.db.withTenant(p, async (tx) => {
      await this.check(tx, v);
      const n = await tx
        .selectFrom('routing_rule')
        .select([sql<string>`count(*)`.as('n'), sql<number>`coalesce(max(position), 0)`.as('max')])
        .executeTakeFirstOrThrow();
      if (Number(n.n) >= MAX_RULES)
        throw unprocessable('too_many', `Keep it to ${MAX_RULES} rules or fewer`);
      const r = await tx
        .insertInto('routing_rule')
        .values({ ...this.values(v), position: Number(n.max) + 10, created_by: p.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'routing.create',
          orgId: null,
          targetType: 'routing_rule',
          targetId: r.id,
          diff: { name: v.name },
        },
      );
      return view(r);
    });
  }

  @Put('rules/:id')
  @RequirePermission('routing:manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, raw);
    const v = parse(RoutingRuleRequest, body);
    return this.db.withTenant(p, async (tx) => {
      await this.check(tx, v);
      const r = await tx
        .updateTable('routing_rule')
        .set(this.values(v))
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!r) throw notFound('Rule');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'routing.update',
          orgId: null,
          targetType: 'routing_rule',
          targetId: id,
          diff: { name: v.name, enabled: v.enabled },
        },
      );
      return view(r);
    });
  }

  /** Saves a new order: the ids in the order they should run. */
  @Put('order')
  @RequirePermission('routing:manage')
  order(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { ids } = parse(Order, body);
    return this.db.withTenant(p, async (tx) => {
      const all = await tx.selectFrom('routing_rule').select('id').execute();
      if (all.length !== ids.length || !all.every((r) => ids.includes(r.id)))
        throw unprocessable('order', 'The order must list every rule exactly once');
      for (const [i, id] of ids.entries())
        await tx
          .updateTable('routing_rule')
          .set({ position: (i + 1) * 10 })
          .where('id', '=', id)
          .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'routing.reorder', orgId: null, targetType: 'routing_rule' },
      );
      return {
        items: (await tx.selectFrom('routing_rule').selectAll().orderBy('position').execute()).map(
          view,
        ),
      };
    });
  }

  @Delete('rules/:id')
  @HttpCode(204)
  @RequirePermission('routing:manage')
  async remove(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
  ) {
    const id = parse(Id, raw);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .deleteFrom('routing_rule')
        .where('id', '=', id)
        .returning('name')
        .executeTakeFirst();
      if (!r) throw notFound('Rule');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'routing.delete',
          orgId: null,
          targetType: 'routing_rule',
          targetId: id,
          diff: { name: r.name },
        },
      );
    });
  }
}
