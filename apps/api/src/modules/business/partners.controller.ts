import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { DelegationCreate, type DelegationView, type PartnerCustomer } from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();

/**
 * Partner (reseller) access. WatchDog staff decide which partner may open and follow cases for
 * which customer; the customer's administrators see who has access and can end it at any time.
 */
@Controller('api/v1')
export class PartnersController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async list(tx: Tx, where: { customer?: string; partner?: string; active?: boolean }) {
    let q = tx
      .selectFrom('partner_delegation as d')
      .innerJoin('organization as p', 'p.id', 'd.partner_org_id')
      .innerJoin('organization as c', 'c.id', 'd.customer_org_id')
      .leftJoin('app_user as g', 'g.id', 'd.granted_by')
      .select([
        'd.id',
        'd.partner_org_id',
        'p.name as partner_name',
        'd.customer_org_id',
        'c.name as customer_name',
        'd.created_at',
        'd.expires_at',
        'd.revoked_at',
        'g.display_name as granted_by',
      ]);
    if (where.customer) q = q.where('d.customer_org_id', '=', where.customer);
    if (where.partner) q = q.where('d.partner_org_id', '=', where.partner);
    if (where.active)
      q = q
        .where('d.revoked_at', 'is', null)
        .where((eb) =>
          eb.or([eb('d.expires_at', 'is', null), eb('d.expires_at', '>', new Date())]),
        );
    const rows = await q
      .orderBy('p.name')
      .orderBy('c.name')
      .orderBy('d.created_at', 'desc')
      .execute();
    return rows.map((r): DelegationView => ({
      id: r.id,
      partnerOrgId: r.partner_org_id,
      partnerName: r.partner_name,
      customerOrgId: r.customer_org_id,
      customerName: r.customer_name,
      since: r.created_at.toISOString(),
      expiresAt: r.expires_at?.toISOString() ?? null,
      revokedAt: r.revoked_at?.toISOString() ?? null,
      grantedBy: r.granted_by,
    }));
  }

  // ------------------------------------------------------------------ staff
  @Get('admin/partners')
  @RequirePermission('partner:manage')
  async overview(@CurrentPrincipal() p: Principal) {
    return this.db.withTenant(p, async (tx) => {
      const orgs = await tx
        .selectFrom('organization')
        .select(['id', 'name', 'org_type'])
        .where('org_type', 'in', ['partner', 'customer'])
        .where('status', '=', 'active')
        .orderBy('name')
        .execute();
      return {
        partners: orgs
          .filter((o) => o.org_type === 'partner')
          .map(({ id, name }) => ({ id, name })),
        customers: orgs
          .filter((o) => o.org_type === 'customer')
          .map(({ id, name }) => ({ id, name })),
        delegations: await this.list(tx, {}),
      };
    });
  }

  @Post('admin/partners/delegations')
  @RequirePermission('partner:manage')
  async grant(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(DelegationCreate, body);
    const expires = b.expiresOn ? new Date(`${b.expiresOn}T23:59:59+05:30`) : null;
    if (expires && expires.getTime() < Date.now())
      throw unprocessable('expires', 'The end date must be in the future');
    return this.db.withTenant(p, async (tx) => {
      const orgs = await tx
        .selectFrom('organization')
        .select(['id', 'org_type'])
        .where('id', 'in', [b.partnerOrgId, b.customerOrgId])
        .where('status', '=', 'active')
        .execute();
      if (orgs.find((o) => o.id === b.partnerOrgId)?.org_type !== 'partner')
        throw unprocessable('partner', 'Choose a partner organisation');
      if (orgs.find((o) => o.id === b.customerOrgId)?.org_type !== 'customer')
        throw unprocessable('customer', 'Choose a customer organisation');
      const open = await tx
        .selectFrom('partner_delegation')
        .select('id')
        .where('partner_org_id', '=', b.partnerOrgId)
        .where('customer_org_id', '=', b.customerOrgId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (open)
        throw conflict('delegation-exists', 'This partner already has access to this customer');
      const d = await tx
        .insertInto('partner_delegation')
        .values({
          partner_org_id: b.partnerOrgId,
          customer_org_id: b.customerOrgId,
          granted_by: p.userId,
          expires_at: expires,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await emit(tx, 'partner.access', b.customerOrgId, { delegationId: d.id, granted: true });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'partner.grant',
          orgId: b.customerOrgId,
          targetType: 'partner_delegation',
          targetId: d.id,
          diff: { partnerOrgId: b.partnerOrgId },
        },
      );
      return { delegations: await this.list(tx, {}) };
    });
  }

  @Post('admin/partners/delegations/:id/revoke')
  @RequirePermission('partner:manage')
  async staffRevoke(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
  ) {
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      await this.revoke(tx, p, ctx, id, null);
      return { delegations: await this.list(tx, {}) };
    });
  }

  private async revoke(
    tx: Tx,
    p: Principal,
    ctx: RequestContext,
    id: string,
    customer: string | null,
  ) {
    let q = tx
      .updateTable('partner_delegation')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .where('revoked_at', 'is', null);
    if (customer) q = q.where('customer_org_id', '=', customer);
    const r = await q.returning(['customer_org_id', 'partner_org_id']).executeTakeFirst();
    if (!r) throw notFound('Partner access');
    await audit(
      tx,
      { ...ctx, actorId: p.userId },
      {
        action: 'partner.revoke',
        orgId: r.customer_org_id,
        targetType: 'partner_delegation',
        targetId: id,
        diff: { partnerOrgId: r.partner_org_id },
      },
    );
  }

  // ------------------------------------------------------------------ customer administrators
  @Get('org/partners')
  @RequirePermission('org:users:manage')
  async mine(@CurrentPrincipal() p: Principal): Promise<{ items: DelegationView[] }> {
    if (p.isInternal) throw forbidden();
    // The partner organisation is not visible to the customer under RLS; read as the system,
    // limited to this customer's own delegations.
    return {
      items: await this.db.withSystem((tx) => this.list(tx, { customer: p.orgId, active: true })),
    };
  }

  @Post('org/partners/:id/revoke')
  @RequirePermission('org:users:manage')
  async customerRevoke(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
  ): Promise<{ items: DelegationView[] }> {
    if (p.isInternal) throw forbidden();
    const id = parse(Id, raw);
    await this.db.withTenant(p, async (tx) => {
      await this.revoke(tx, p, ctx, id, p.orgId);
    });
    return {
      items: await this.db.withSystem((tx) => this.list(tx, { customer: p.orgId, active: true })),
    };
  }

  // ------------------------------------------------------------------ partners
  @Get('partner/customers')
  @RequirePermission('case:read:delegated')
  async customers(@CurrentPrincipal() p: Principal): Promise<{ items: PartnerCustomer[] }> {
    if (!p.delegatedOrgIds.length) return { items: [] };
    const rows = await this.db.withTenant(p, (tx) =>
      sql<{ id: string; name: string; open: string; devices: string; ending: string }>`
        SELECT o.id, o.name,
               (SELECT count(*) FROM support_case c WHERE c.org_id = o.id AND c.status NOT IN ('resolved', 'closed')) AS open,
               (SELECT count(*) FROM asset a WHERE a.org_id = o.id AND a.retired_at IS NULL) AS devices,
               (SELECT count(DISTINCT e.asset_id) FROM entitlement e
                 WHERE e.org_id = o.id AND e.ends_on BETWEEN current_date AND current_date + 60
                   AND NOT EXISTS (SELECT 1 FROM entitlement n WHERE n.asset_id = e.asset_id AND n.ends_on > e.ends_on)) AS ending
          FROM organization o
         WHERE o.id = ANY(${p.delegatedOrgIds}::uuid[]) AND o.status = 'active'
         ORDER BY o.name`.execute(tx),
    );
    return {
      items: rows.rows.map((r) => ({
        id: r.id,
        name: r.name,
        openCases: Number(r.open),
        devices: Number(r.devices),
        coverageEndingSoon: Number(r.ending),
      })),
    };
  }
}
