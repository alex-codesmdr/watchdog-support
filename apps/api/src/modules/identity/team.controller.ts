import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { TeamInvite, TeamMemberUpdate, type TeamMember, type TeamRole } from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const TEAM_ROLES: TeamRole[] = ['customer_admin', 'customer_user'];
const MAX_MEMBERS = 500;

/**
 * Customer administrators manage the people in their own organisation: invite, change between
 * administrator and user, switch access off and on. RLS keeps them inside their organisation; the
 * role-grant trigger stops anyone giving themselves or a customer a staff role.
 */
@Controller('api/v1/org/users')
export class TeamController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private human(p: Principal) {
    if (p.apiKeyId || p.isInternal) throw forbidden();
  }

  private async members(tx: Tx, p: Principal): Promise<TeamMember[]> {
    const rows = await tx
      .selectFrom('app_user as u')
      .select([
        'u.id',
        'u.display_name',
        'u.email',
        'u.status',
        'u.last_login_at',
        sql<string[]>`ARRAY(SELECT role_key FROM user_role r WHERE r.user_id = u.id)`.as('roles'),
      ])
      .where('u.org_id', '=', p.orgId)
      .where('u.is_service', '=', false)
      .orderBy('u.display_name')
      .limit(MAX_MEMBERS)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      email: r.email,
      role: r.roles.includes('customer_admin') ? 'customer_admin' : 'customer_user',
      status: r.status,
      lastLoginAt: r.last_login_at?.toISOString() ?? null,
      isMe: r.id === p.userId,
    }));
  }

  @Get()
  @RequirePermission('org:users:manage')
  list(@CurrentPrincipal() p: Principal): Promise<{ items: TeamMember[] }> {
    this.human(p);
    return this.db.withTenant(p, async (tx) => ({ items: await this.members(tx, p) }));
  }

  @Post()
  @RequirePermission('org:users:manage')
  @RateLimit('team-invite', 30, 3600)
  invite(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<TeamMember> {
    this.human(p);
    const b = parse(TeamInvite, body);
    return this.db.withTenant(p, async (tx) => {
      // Emails are unique across the portal; say so without revealing which organisation has it.
      const taken = await sql<{
        taken: boolean;
      }>`SELECT wd.email_taken(${b.email}) AS taken`.execute(tx);
      if (taken.rows[0]?.taken)
        throw conflict('email_taken', 'This email address already has a WatchDog Support account.');
      const u = await tx
        .insertInto('app_user')
        .values({
          org_id: p.orgId,
          email: b.email,
          display_name: b.displayName,
          status: 'invited',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('user_role')
        .values({ user_id: u.id, role_key: b.role, granted_by: p.userId })
        .execute();
      await emit(tx, 'user.invited', p.orgId, { userId: u.id, invitedBy: p.userId });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'user.invite',
          orgId: p.orgId,
          targetType: 'user',
          targetId: u.id,
          diff: { email: b.email, role: b.role },
        },
      );
      return (await this.members(tx, p)).find((m) => m.id === u.id)!;
    });
  }

  @Post(':id/resend-invite')
  @HttpCode(202)
  @RequirePermission('org:users:manage')
  @RateLimit('team-resend', 10, 3600)
  resend(@CurrentPrincipal() p: Principal, @Param('id') raw: string) {
    this.human(p);
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      const u = await tx
        .selectFrom('app_user')
        .select('status')
        .where('id', '=', id)
        .where('org_id', '=', p.orgId)
        .executeTakeFirst();
      if (!u) throw notFound('Person');
      if (u.status !== 'invited')
        throw conflict('not_invited', 'This person has already set up their account.');
      await emit(tx, 'user.invited', p.orgId, { userId: id, invitedBy: p.userId });
      return { status: 'sent' };
    });
  }

  @Patch(':id')
  @RequirePermission('org:users:manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<TeamMember> {
    this.human(p);
    const id = parse(Id, raw);
    const b = parse(TeamMemberUpdate, body);
    if (id === p.userId)
      throw forbidden('You cannot change your own role or access. Ask another administrator.');
    return this.db.withTenant(p, async (tx) => {
      // Serialise changes within the organisation so two admins cannot demote each other at once.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`team:${p.orgId}`}))`.execute(tx);
      const all = await this.members(tx, p);
      const m = all.find((x) => x.id === id);
      if (!m) throw notFound('Person');
      const nextRole = b.role ?? m.role;
      const nextStatus = b.status ?? (m.status === 'disabled' ? 'disabled' : m.status);
      const adminsAfter = all.filter((x) =>
        x.id === id
          ? nextRole === 'customer_admin' && nextStatus !== 'disabled'
          : x.role === 'customer_admin' && x.status !== 'disabled',
      ).length;
      if (adminsAfter === 0)
        throw unprocessable(
          'last_admin',
          'Your organisation needs at least one active administrator.',
        );
      if (b.role && b.role !== m.role) {
        await tx
          .deleteFrom('user_role')
          .where('user_id', '=', id)
          .where('role_key', 'in', TEAM_ROLES)
          .execute();
        await tx
          .insertInto('user_role')
          .values({ user_id: id, role_key: b.role, granted_by: p.userId })
          .execute();
      }
      if (b.status && b.status !== m.status) {
        // An invited person being re-enabled goes back to "invited" until they sign in.
        const status =
          b.status === 'active' && !(await this.everSignedIn(tx, id)) ? 'invited' : b.status;
        await tx.updateTable('app_user').set({ status }).where('id', '=', id).execute();
      }
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'user.update',
          orgId: p.orgId,
          targetType: 'user',
          targetId: id,
          diff: {
            ...(b.role && b.role !== m.role ? { role: [m.role, b.role] } : {}),
            ...(b.status && b.status !== m.status ? { status: [m.status, b.status] } : {}),
          },
        },
      );
      return (await this.members(tx, p)).find((x) => x.id === id)!;
    });
  }

  private async everSignedIn(tx: Tx, id: string) {
    const r = await tx
      .selectFrom('app_user')
      .select(sql<boolean>`kc_subject IS NOT NULL`.as('linked'))
      .where('id', '=', id)
      .executeTakeFirst();
    return Boolean(r?.linked);
  }
}
