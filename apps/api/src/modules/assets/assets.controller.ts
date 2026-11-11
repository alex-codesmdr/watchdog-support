import { Controller, Get, Inject, Query } from '@nestjs/common';
import { sql } from 'kysely';
import type { AssetSummary, SerialValidation } from '@wd/contracts';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { RateLimit } from '../../common/rate-limit.js';
import type { Principal } from '../../common/principal.js';

const TIER_RANK: Record<string, number> = { mission_critical: 3, premium: 2, standard: 1 };

@Controller('api/v1/assets')
export class AssetsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @RequirePermission('asset:read:org', 'asset:read:delegated', 'asset:read:all')
  async list(
    @CurrentPrincipal() p: Principal,
    @Query('orgId') orgId?: string,
  ): Promise<{ items: AssetSummary[] }> {
    const target = z
      .string()
      .uuid()
      .optional()
      .parse(orgId || undefined);
    return this.db.withTenant(p, async (tx) => ({
      items: await this.query(tx, p, { orgId: target }),
    }));
  }

  /** Used by the case form to validate a serial and show the entitlement before submission. */
  @Get('validate')
  @RequirePermission('asset:read:org', 'asset:read:delegated', 'asset:read:all')
  @RateLimit('serial-validate', 120, 60)
  async validate(
    @CurrentPrincipal() p: Principal,
    @Query('serial') serial?: string,
    @Query('orgId') orgId?: string,
  ): Promise<SerialValidation> {
    const s = z.string().trim().toUpperCase().min(3).max(64).parse(serial);
    const target = z
      .string()
      .uuid()
      .optional()
      .parse(orgId || undefined);
    return this.db.withTenant(p, async (tx) => {
      const [a] = await this.query(tx, p, { serial: s, orgId: target });
      if (!a) return { valid: false, asset: null, reason: 'not_found' };
      if (!a.entitlement) return { valid: p.isInternal, asset: a, reason: 'not_entitled' };
      return { valid: true, asset: a, reason: 'ok' };
    });
  }

  private async query(
    tx: Tx,
    p: Principal,
    f: { serial?: string; orgId?: string },
  ): Promise<AssetSummary[]> {
    let q = tx
      .selectFrom('asset as a')
      .innerJoin('product as pr', 'pr.id', 'a.product_id')
      .innerJoin('product_family as f', 'f.id', 'pr.family_id')
      .leftJoin('site as s', 's.id', 'a.site_id')
      .leftJoin('product as rp', 'rp.id', 'pr.replacement_product_id')
      .select([
        'pr.lifecycle',
        sql<string | null>`to_char(pr.eos_date, 'YYYY-MM-DD')`.as('eos_date'),
        sql<string | null>`to_char(pr.eol_date, 'YYYY-MM-DD')`.as('eol_date'),
        'pr.lifecycle_note',
        'rp.model_name as replacement',
        'a.id',
        'a.serial_number',
        'a.product_id',
        'pr.model_name',
        'f.key as family_key',
        'a.site_id',
        's.name as site_name',
        'a.current_version',
      ])
      .orderBy('a.serial_number')
      .limit(500);
    // RLS already limits to visible orgs; customers see their own org unless they pick a delegated one.
    // Devices returned under an RMA stay on record but are no longer installed.
    q = q.where('a.retired_at', 'is', null);
    const org = f.orgId ?? (p.isInternal ? undefined : p.orgId);
    if (org) q = q.where('a.org_id', '=', org);
    if (f.serial) q = q.where('a.serial_number', '=', f.serial);
    const rows = await q.execute();
    if (!rows.length) return [];
    const ents = await tx
      .selectFrom('entitlement')
      .select([
        'asset_id',
        'tier',
        'kind',
        sql<string>`to_char(ends_on, 'YYYY-MM-DD')`.as('ends_on'),
      ])
      .where(
        'asset_id',
        'in',
        rows.map((r) => r.id),
      )
      .where(sql<boolean>`current_date BETWEEN starts_on AND ends_on`)
      .execute();
    return rows.map((r) => {
      const e = ents
        .filter((x) => x.asset_id === r.id)
        .sort((a, b) => TIER_RANK[b.tier]! - TIER_RANK[a.tier]!)[0];
      return {
        id: r.id,
        serialNumber: r.serial_number,
        productId: r.product_id,
        modelName: r.model_name,
        familyKey: r.family_key,
        siteId: r.site_id,
        siteName: r.site_name,
        currentVersion: r.current_version,
        entitlement: e ? { tier: e.tier, kind: e.kind, endsOn: e.ends_on } : null,
        lifecycle:
          r.lifecycle === 'ga'
            ? null
            : {
                stage: r.lifecycle as 'eos_announced' | 'eos' | 'eol',
                endOfSale: r.eos_date,
                endOfSupport: r.eol_date,
                advice: r.lifecycle_note,
                replacement: r.replacement,
              },
      };
    });
  }
}
