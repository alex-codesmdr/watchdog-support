import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { sql } from 'kysely';
import {
  AssetUpdateRequest,
  RenewalRequestBody,
  SiteRequest,
  type RenewalView,
  type SiteView,
} from '@wd/contracts';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { audit } from '../../common/audit.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const uuid = z.string().uuid();
const READ = ['asset:read:org', 'asset:read:delegated', 'asset:read:all'];

/**
 * Sites, device placement and renewal requests. Customer admins manage their own organisation;
 * staff may act on any organisation (orgId required). RLS remains the outer wall.
 */
@Controller('api/v1')
export class SitesController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Which organisation a write targets: own org for customer admins, explicit for staff. */
  private targetOrg(p: Principal, orgId?: string): string {
    if (p.isInternal) {
      if (!orgId) throw unprocessable('org', 'Choose the customer organisation');
      return orgId;
    }
    if (!has(p, 'asset:manage:org'))
      throw forbidden('Only your organisation administrator can change sites and devices');
    if (orgId && orgId !== p.orgId) throw notFound('Organisation');
    return p.orgId;
  }

  @Get('sites')
  @RequirePermission(...READ)
  async sites(
    @CurrentPrincipal() p: Principal,
    @Query('orgId') orgId?: string,
  ): Promise<{ items: SiteView[] }> {
    const target = uuid.optional().parse(orgId || undefined);
    return this.db.withTenant(p, async (tx) => {
      let q = tx
        .selectFrom('site as s')
        .leftJoin('asset as a', 'a.site_id', 's.id')
        .select([
          's.id',
          's.org_id',
          's.name',
          's.address',
          's.city',
          's.state',
          's.pincode',
          sql<string>`count(a.id)`.as('n'),
        ])
        .groupBy('s.id')
        .orderBy('s.name');
      const org = target ?? (p.isInternal ? undefined : p.orgId);
      if (org) q = q.where('s.org_id', '=', org);
      const rows = await q.limit(500).execute();
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          name: r.name,
          address: r.address,
          city: r.city,
          state: r.state,
          pincode: r.pincode,
          assetCount: Number(r.n),
        })),
      };
    });
  }

  @Post('sites')
  @RequirePermission('asset:manage:org', 'asset:import')
  async createSite(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<SiteView> {
    const b = parse(SiteRequest, body);
    const org = this.targetOrg(p, b.orgId);
    return this.db.withTenant(p, async (tx) => {
      const exists = await tx
        .selectFrom('site')
        .select('id')
        .where('org_id', '=', org)
        .where('name', '=', b.name)
        .executeTakeFirst();
      if (exists) throw conflict('site-exists', 'A site with this name already exists');
      const s = await tx
        .insertInto('site')
        .values({
          org_id: org,
          name: b.name,
          address: b.address ?? null,
          city: b.city ?? null,
          state: b.state ?? null,
          pincode: b.pincode ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'site.create', orgId: org, targetType: 'site', targetId: s.id },
      );
      return {
        id: s.id,
        orgId: s.org_id,
        name: s.name,
        address: s.address,
        city: s.city,
        state: s.state,
        pincode: s.pincode,
        assetCount: 0,
      };
    });
  }

  @Patch('sites/:id')
  @RequirePermission('asset:manage:org', 'asset:import')
  async updateSite(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(SiteRequest, body);
    return this.db.withTenant(p, async (tx) => {
      const s = await this.ownSite(tx, p, uuid.parse(id));
      await tx
        .updateTable('site')
        .set({
          name: b.name,
          address: b.address ?? null,
          city: b.city ?? null,
          state: b.state ?? null,
          pincode: b.pincode ?? null,
        })
        .where('id', '=', s.id)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'site.update', orgId: s.org_id, targetType: 'site', targetId: s.id },
      );
      return { status: 'updated' };
    });
  }

  @Delete('sites/:id')
  @HttpCode(204)
  @RequirePermission('asset:manage:org', 'asset:import')
  async deleteSite(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    await this.db.withTenant(p, async (tx) => {
      const s = await this.ownSite(tx, p, uuid.parse(id));
      const used = await tx
        .selectFrom('asset')
        .select('id')
        .where('site_id', '=', s.id)
        .executeTakeFirst();
      if (used) throw conflict('site-in-use', 'Move the devices at this site before deleting it');
      await tx.deleteFrom('site').where('id', '=', s.id).execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'site.delete', orgId: s.org_id, targetType: 'site', targetId: s.id },
      );
    });
  }

  /** Moves a device to another site of the same organisation. */
  @Patch('assets/:id')
  @RequirePermission('asset:manage:org', 'asset:import')
  async updateAsset(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(AssetUpdateRequest, body);
    return this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('asset')
        .select(['id', 'org_id', 'site_id'])
        .where('id', '=', uuid.parse(id))
        .executeTakeFirst();
      if (!a || (!p.isInternal && a.org_id !== p.orgId)) throw notFound('Device');
      if (!p.isInternal && !has(p, 'asset:manage:org')) throw forbidden();
      if (b.siteId) {
        const s = await tx
          .selectFrom('site')
          .select('org_id')
          .where('id', '=', b.siteId)
          .executeTakeFirst();
        if (!s || s.org_id !== a.org_id)
          throw unprocessable('site', 'The site must belong to the same organisation');
      }
      await tx.updateTable('asset').set({ site_id: b.siteId }).where('id', '=', a.id).execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'asset.move',
          orgId: a.org_id,
          targetType: 'asset',
          targetId: a.id,
          diff: { from: a.site_id, to: b.siteId },
        },
      );
      return { status: 'updated' };
    });
  }

  /** Customer asks for a renewal quote. One open request per device. */
  @Post('assets/:id/renewal-request')
  @RequirePermission('renewal:request')
  @RateLimit('renewal-request', 30, 3600)
  async renewal(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RenewalView> {
    const b = parse(RenewalRequestBody, body);
    return this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('asset')
        .select(['id', 'org_id', 'serial_number'])
        .where('id', '=', uuid.parse(id))
        .executeTakeFirst();
      if (!a || (a.org_id !== p.orgId && !p.delegatedOrgIds.includes(a.org_id)))
        throw notFound('Device');
      const open = await tx
        .selectFrom('renewal_request')
        .select('id')
        .where('asset_id', '=', a.id)
        .where('status', '=', 'requested')
        .executeTakeFirst();
      if (open)
        throw conflict(
          'renewal-open',
          'A renewal quote has already been requested for this device',
        );
      const ent = await tx
        .selectFrom('entitlement')
        .select('id')
        .where('asset_id', '=', a.id)
        .orderBy('ends_on', 'desc')
        .executeTakeFirst();
      const r = await tx
        .insertInto('renewal_request')
        .values({
          org_id: a.org_id,
          asset_id: a.id,
          entitlement_id: ent?.id ?? null,
          requested_by: p.userId,
          desired_tier: b.desiredTier ?? null,
          note: b.note ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await emit(tx, 'renewal.requested', a.org_id, { renewalId: r.id });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'renewal.request', orgId: a.org_id, targetType: 'asset', targetId: a.id },
      );
      return {
        id: r.id,
        assetId: a.id,
        serialNumber: a.serial_number,
        status: 'requested',
        desiredTier: (r.desired_tier ?? null) as RenewalView['desiredTier'],
        createdAt: r.created_at.toISOString(),
      };
    });
  }

  @Get('renewal-requests')
  @RequirePermission('renewal:request', 'asset:read:all')
  async renewals(@CurrentPrincipal() p: Principal): Promise<{ items: RenewalView[] }> {
    return this.db.withTenant(p, async (tx) => {
      let q = tx
        .selectFrom('renewal_request as r')
        .innerJoin('asset as a', 'a.id', 'r.asset_id')
        .select([
          'r.id',
          'r.asset_id',
          'a.serial_number',
          'r.status',
          'r.desired_tier',
          'r.created_at',
        ])
        .orderBy('r.created_at', 'desc')
        .limit(200);
      if (!p.isInternal) q = q.where('r.org_id', '=', p.orgId);
      const rows = await q.execute();
      return {
        items: rows.map((r) => ({
          id: r.id,
          assetId: r.asset_id,
          serialNumber: r.serial_number,
          status: r.status as RenewalView['status'],
          desiredTier: r.desired_tier as RenewalView['desiredTier'],
          createdAt: r.created_at.toISOString(),
        })),
      };
    });
  }

  private async ownSite(tx: Tx, p: Principal, id: string) {
    const s = await tx
      .selectFrom('site')
      .select(['id', 'org_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s || (!p.isInternal && s.org_id !== p.orgId)) throw notFound('Site');
    if (!p.isInternal && !has(p, 'asset:manage:org')) throw forbidden();
    return s;
  }
}
