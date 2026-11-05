import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import {
  RegistrationDecision,
  RegistrationRequest,
  type Me,
  type RegistrationSummary,
} from '@wd/contracts';
import { z } from 'zod';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import { audit } from '../../common/audit.js';
import { conflict, notFound } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

export const PRIVACY_NOTICE_VERSION = '2026-11-01';

@Controller('api/v1')
export class IdentityController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('me')
  async me(@CurrentPrincipal() p: Principal): Promise<Me> {
    return this.db.withTenant(p, async (tx) => {
      const u = await tx
        .selectFrom('app_user as u')
        .innerJoin('organization as o', 'o.id', 'u.org_id')
        .select([
          'u.id',
          'u.email',
          'u.display_name',
          'u.locale',
          'u.timezone',
          'o.id as org_id',
          'o.name as org_name',
          'o.org_type',
        ])
        .where('u.id', '=', p.userId)
        .executeTakeFirstOrThrow();
      return {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        org: { id: u.org_id, name: u.org_name, type: u.org_type },
        roles: p.roles,
        permissions: p.permissions,
        isInternal: p.isInternal,
        locale: u.locale,
        timezone: u.timezone,
      };
    });
  }

  /** Public self-registration. Always answers 202 with the same body (no account enumeration). */
  @Public()
  @Post('public/registrations')
  @HttpCode(202)
  @RateLimit('register', 5, 3600)
  async register(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(RegistrationRequest, body);
    if (b.consentNoticeVersion !== PRIVACY_NOTICE_VERSION)
      throw conflict(
        'notice-changed',
        'The privacy notice has been updated. Please review it again.',
      );
    await this.db.withAnonymous(async (tx) => {
      const r = await sql<{
        id: string | null;
      }>`SELECT wd.register_organization(${b.organizationName}, ${b.gstin ?? null}, ${b.adminName}, ${b.adminEmail}, ${b.phone ?? null}, ${b.consentNoticeVersion}, ${ctx.ip}::inet) AS id`.execute(
        tx,
      );
      const id = r.rows[0]?.id;
      if (id) await emit(tx, 'registration.received', null, { registrationId: id });
    });
    return {
      status: 'received',
      message: 'Thank you. We will review your request and email you within one business day.',
    };
  }

  /** Staff: customer and partner organisations, for filters and pickers. */
  @Get('organizations')
  @RequirePermission('case:read:all', 'report:ops:read:all', 'asset:import')
  async allOrganizations(@CurrentPrincipal() p: Principal) {
    return this.db.withTenant(p, async (tx) => ({
      items: await tx
        .selectFrom('organization')
        .select(['id', 'name', 'org_type as type'])
        .where('org_type', '!=', 'internal')
        .where('status', '=', 'active')
        .orderBy('name')
        .limit(2000)
        .execute(),
    }));
  }

  /** Organisations the user can open cases for: their own, plus delegating customers (partners). */
  @Get('me/organizations')
  async organizations(@CurrentPrincipal() p: Principal) {
    if (p.isInternal) return { items: [] };
    const ids = [p.orgId, ...p.delegatedOrgIds];
    return this.db.withTenant(p, async (tx) => {
      const rows = await tx
        .selectFrom('organization')
        .select(['id', 'name', 'org_type'])
        .where('id', 'in', ids)
        .where('status', '=', 'active')
        .orderBy('name')
        .execute();
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          own: r.id === p.orgId,
          type: r.org_type,
        })),
      };
    });
  }

  @Get('admin/registrations')
  @RequirePermission('registration:approve')
  async registrations(
    @CurrentPrincipal() p: Principal,
    @Query('status') status?: string,
  ): Promise<{ items: RegistrationSummary[] }> {
    const s = z
      .enum(['pending', 'approved', 'rejected'])
      .default('pending')
      .parse(status ?? undefined);
    const rows = await this.db.withTenant(p, (tx) =>
      tx
        .selectFrom('registration as r')
        .innerJoin('organization as o', 'o.id', 'r.org_id')
        .select([
          'r.id',
          'o.name',
          'r.admin_name',
          'r.admin_email',
          'r.email_domain',
          'r.status',
          'r.created_at',
        ])
        .where('r.status', '=', s)
        .orderBy('r.created_at')
        .limit(200)
        .execute(),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        organizationName: r.name,
        adminName: r.admin_name,
        adminEmail: r.admin_email,
        emailDomain: r.email_domain,
        status: r.status,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  @Post('admin/registrations/:id/decision')
  @HttpCode(200)
  @RequirePermission('registration:approve')
  async decide(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(RegistrationDecision, body);
    const result = await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .selectFrom('registration')
        .selectAll()
        .where('id', '=', z.string().uuid().parse(id))
        .forUpdate()
        .executeTakeFirst();
      if (!r) throw notFound('Registration');
      if (r.status !== 'pending')
        throw conflict('decided', 'This registration was already decided');
      const approve = b.decision === 'approve';
      await tx
        .updateTable('registration')
        .set({
          status: approve ? 'approved' : 'rejected',
          decided_by: p.userId,
          decided_at: new Date(),
          reason: b.reason ?? null,
        })
        .where('id', '=', r.id)
        .execute();
      await tx
        .updateTable('organization')
        .set({ status: approve ? 'active' : 'rejected' })
        .where('id', '=', r.org_id)
        .execute();
      if (approve) {
        const u = await tx
          .selectFrom('app_user')
          .select(['id', 'display_name'])
          .where('email', '=', r.admin_email)
          .executeTakeFirstOrThrow();
        await tx
          .insertInto('user_role')
          .values({ user_id: u.id, role_key: 'customer_admin', granted_by: p.userId })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      await emit(tx, approve ? 'registration.approved' : 'registration.rejected', r.org_id, {
        registrationId: r.id,
      });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: `registration.${b.decision}`,
          orgId: r.org_id,
          targetType: 'registration',
          targetId: r.id,
        },
      );
      return { email: r.admin_email, name: r.admin_name, approve };
    });
    // Login identity + set-up email are created by the worker from the outbox event (retried on failure).
    return { status: result.approve ? 'approved' : 'rejected' };
  }
}
