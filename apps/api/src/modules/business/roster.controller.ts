import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ShiftCreate, type Roster } from '@wd/contracts';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { forbidden, notFound, unprocessable } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const ENGINEER_ROLES = ['l1_engineer', 'l2_engineer', 'l3_engineer', 'support_manager'];

/**
 * Engineer shifts and the P1 on-call duty. Routing prefers engineers on shift, and a P1 that no
 * rule assigns goes to the P1 on-call engineer, who is also emailed and texted.
 */
@Controller('api/v1')
export class RosterController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async roster(tx: Tx, from: string): Promise<Roster> {
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(start.getTime() + 7 * 86400_000);
    const rows = await tx
      .selectFrom('oncall_shift as s')
      .innerJoin('app_user as u', 'u.id', 's.user_id')
      .select(['s.id', 's.user_id', 'u.display_name', 's.starts_at', 's.ends_at', 's.p1', 's.note'])
      .where('s.ends_at', '>', start)
      .where('s.starts_at', '<', end)
      .orderBy('s.starts_at')
      .orderBy('u.display_name')
      .execute();
    const now = await tx
      .selectFrom('oncall_shift as s')
      .innerJoin('app_user as u', 'u.id', 's.user_id')
      .select(['u.display_name', 's.p1', 's.ends_at'])
      .where('s.starts_at', '<=', new Date())
      .where('s.ends_at', '>', new Date())
      .orderBy('s.p1', 'desc')
      .orderBy('u.display_name')
      .execute();
    return {
      from,
      to: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
        new Date(end.getTime() - 1),
      ),
      shifts: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: r.display_name,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        p1: r.p1,
        note: r.note,
      })),
      onShiftNow: now.map((n) => ({
        name: n.display_name,
        p1: n.p1,
        until: n.ends_at.toISOString(),
      })),
    };
  }

  @Get('workspace/roster')
  @RequirePermission('case:read:all')
  get(@CurrentPrincipal() p: Principal, @Query('from') raw?: string): Promise<Roster> {
    if (!p.isInternal || p.apiKeyId) throw forbidden();
    const from = raw
      ? parse(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), raw)
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    return this.db.withTenant(p, (tx) => this.roster(tx, from));
  }

  @Post('admin/roster')
  @RequirePermission('roster:manage')
  async add(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<{ added: number }> {
    const b = parse(ShiftCreate, body);
    const s = new Date(b.startsAt);
    const e = new Date(b.endsAt);
    if (e <= s) throw unprocessable('times', 'The shift must end after it starts');
    if (e.getTime() - s.getTime() > 24 * 3600_000)
      throw unprocessable(
        'times',
        'A shift can be at most 24 hours; use "repeat" for several days',
      );
    return this.db.withTenant(p, async (tx) => {
      const eng = await tx
        .selectFrom('app_user as u')
        .innerJoin('user_role as ur', 'ur.user_id', 'u.id')
        .select('u.id')
        .where('u.id', '=', b.userId)
        .where('u.status', '!=', 'disabled')
        .where('ur.role_key', 'in', ENGINEER_ROLES)
        .executeTakeFirst();
      if (!eng) throw unprocessable('user', 'Choose an engineer or support manager');
      const values = Array.from({ length: b.repeatDays + 1 }, (_, i) => ({
        user_id: b.userId,
        starts_at: new Date(s.getTime() + i * 86400_000),
        ends_at: new Date(e.getTime() + i * 86400_000),
        p1: b.p1,
        note: b.note || null,
        created_by: p.userId,
      }));
      await tx.insertInto('oncall_shift').values(values).execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'roster.add',
          orgId: null,
          targetType: 'app_user',
          targetId: b.userId,
          diff: { startsAt: b.startsAt, days: values.length, p1: b.p1 },
        },
      );
      return { added: values.length };
    });
  }

  @Delete('admin/roster/:id')
  @HttpCode(204)
  @RequirePermission('roster:manage')
  async remove(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
  ) {
    const id = parse(Id, raw);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .deleteFrom('oncall_shift')
        .where('id', '=', id)
        .returning('user_id')
        .executeTakeFirst();
      if (!r) throw notFound('Shift');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'roster.remove',
          orgId: null,
          targetType: 'app_user',
          targetId: r.user_id,
          diff: {},
        },
      );
    });
  }
}
