import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  ContractRenewalRequest,
  ContractUpsert,
  InvoiceCreate,
  InvoiceStatusUpdate,
  RenewalStageUpdate,
  type ContractView,
  type InvoiceView,
  type RenewalPipeline,
  type RenewalPipelineItem,
  type RenewalStage,
} from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const INTERNAL_ROLES = [
  'l1_engineer',
  'l2_engineer',
  'l3_engineer',
  'support_manager',
  'system_admin',
];

/** A `date` column as YYYY-MM-DD (pg parses dates as local midnight). */
export const day = (d: Date | string): string =>
  typeof d === 'string'
    ? d.slice(0, 10)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);

/**
 * Support contracts with their value, coverage and invoices. Customer administrators see their
 * own organisation's contracts and can ask to renew one; staff record contracts and invoices and
 * work the renewal pipeline.
 */
@Controller('api/v1')
export class ContractsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async load(tx: Tx, where: { orgId?: string; id?: string }, staff: boolean) {
    let q = tx
      .selectFrom('contract as c')
      .innerJoin('organization as o', 'o.id', 'c.org_id')
      .leftJoin('app_user as u', 'u.id', 'c.owner_id')
      .select([
        'c.id',
        'c.org_id',
        'o.name as org_name',
        'c.ref',
        'c.title',
        'c.value_inr',
        'c.starts_on',
        'c.ends_on',
        'c.owner_id',
        'u.display_name as owner_name',
        'c.renewal_stage',
        'c.renewal_note',
      ]);
    if (where.orgId) q = q.where('c.org_id', '=', where.orgId);
    if (where.id) q = q.where('c.id', '=', where.id);
    const rows = await q.orderBy('c.ends_on').orderBy('c.ref').execute();
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [devices, invoices, asks] = await Promise.all([
      sql<{ contract_id: string; serial_number: string; model_name: string; site: string | null }>`
        SELECT DISTINCT c.id AS contract_id, a.serial_number, p.model_name, s.name AS site
          FROM contract c
          JOIN entitlement e ON e.org_id = c.org_id AND e.contract_ref = c.ref
          JOIN asset a ON a.id = e.asset_id
          JOIN product p ON p.id = a.product_id
          LEFT JOIN site s ON s.id = a.site_id
         WHERE c.id = ANY(${ids}::uuid[])
         ORDER BY p.model_name, a.serial_number`.execute(tx),
      tx
        .selectFrom('invoice')
        .selectAll()
        .where('contract_id', 'in', ids)
        .orderBy('issued_on', 'desc')
        .execute(),
      tx
        .selectFrom('renewal_request')
        .select('contract_id')
        .where('contract_id', 'in', ids)
        .where('status', '=', 'requested')
        .execute(),
    ]);
    const today = istToday();
    return rows.map((r): ContractView => ({
      id: r.id,
      orgId: r.org_id,
      orgName: r.org_name,
      ref: r.ref,
      title: r.title,
      valueInr: Number(r.value_inr),
      startsOn: day(r.starts_on),
      endsOn: day(r.ends_on),
      daysLeft: daysBetween(today, day(r.ends_on)),
      devices: devices.rows
        .filter((d) => d.contract_id === r.id)
        .map((d) => ({ serialNumber: d.serial_number, modelName: d.model_name, siteName: d.site })),
      invoices: invoices
        .filter((i) => i.contract_id === r.id)
        .map((i): InvoiceView => ({
          id: i.id,
          number: i.number,
          issuedOn: day(i.issued_on),
          dueOn: day(i.due_on),
          amountInr: Number(i.amount_inr),
          status:
            i.status === 'issued' && day(i.due_on) < today
              ? 'overdue'
              : (i.status as InvoiceView['status']),
          paidOn: i.paid_on ? day(i.paid_on) : null,
        })),
      renewalRequested: asks.some((a) => a.contract_id === r.id),
      owner: staff && r.owner_id ? { id: r.owner_id, name: r.owner_name ?? '' } : null,
      renewalStage: staff ? (r.renewal_stage as RenewalStage) : null,
      renewalNote: staff ? r.renewal_note : null,
    }));
  }

  // ------------------------------------------------------------------ customers
  @Get('contracts')
  @RequirePermission('contract:read:org')
  async mine(@CurrentPrincipal() p: Principal): Promise<{ items: ContractView[] }> {
    if (p.isInternal) throw forbidden();
    return { items: await this.db.withTenant(p, (tx) => this.load(tx, { orgId: p.orgId }, false)) };
  }

  @Post('contracts/:id/renewal-request')
  @RequirePermission('contract:read:org')
  async askRenewal(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<{ items: ContractView[] }> {
    if (p.isInternal || !has(p, 'renewal:request')) throw forbidden();
    const id = parse(Id, raw);
    const { note } = parse(ContractRenewalRequest, body ?? {});
    return this.db.withTenant(p, async (tx) => {
      const c = await tx
        .selectFrom('contract')
        .select(['id', 'org_id'])
        .where('id', '=', id)
        .where('org_id', '=', p.orgId)
        .executeTakeFirst();
      if (!c) throw notFound('Contract');
      const open = await tx
        .selectFrom('renewal_request')
        .select('id')
        .where('contract_id', '=', id)
        .where('status', '=', 'requested')
        .executeTakeFirst();
      if (open)
        throw conflict('renewal-open', 'A renewal has already been requested for this contract');
      const r = await tx
        .insertInto('renewal_request')
        .values({ org_id: p.orgId, contract_id: id, requested_by: p.userId, note: note || null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await emit(tx, 'contract.renewal_requested', p.orgId, { renewalId: r.id, contractId: id });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'contract.renewal_request',
          orgId: p.orgId,
          targetType: 'contract',
          targetId: id,
          diff: {},
        },
      );
      return { items: await this.load(tx, { orgId: p.orgId }, false) };
    });
  }

  // ------------------------------------------------------------------ staff
  @Get('admin/contracts')
  @RequirePermission('contract:manage')
  async all(
    @CurrentPrincipal() p: Principal,
    @Query('orgId') orgId?: string,
  ): Promise<{ items: ContractView[] }> {
    const o = orgId ? parse(Id, orgId) : undefined;
    return { items: await this.db.withTenant(p, (tx) => this.load(tx, { orgId: o }, true)) };
  }

  private async checkOwner(tx: Tx, ownerId: string | null | undefined) {
    if (!ownerId) return;
    const u = await tx
      .selectFrom('app_user as u')
      .innerJoin('user_role as ur', 'ur.user_id', 'u.id')
      .select('u.id')
      .where('u.id', '=', ownerId)
      .where('ur.role_key', 'in', INTERNAL_ROLES)
      .executeTakeFirst();
    if (!u) throw unprocessable('owner', 'The account owner must be a WatchDog staff member');
  }

  @Post('admin/contracts')
  @RequirePermission('contract:manage')
  async create(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const b = parse(ContractUpsert, body);
    if (b.endsOn < b.startsOn)
      throw unprocessable('dates', 'The end date is before the start date');
    return this.db.withTenant(p, async (tx) => {
      const org = await tx
        .selectFrom('organization')
        .select('id')
        .where('id', '=', b.orgId)
        .where('org_type', '!=', 'internal')
        .executeTakeFirst();
      if (!org) throw notFound('Organisation');
      await this.checkOwner(tx, b.ownerId);
      const dup = await tx
        .selectFrom('contract')
        .select('id')
        .where('org_id', '=', b.orgId)
        .where('ref', '=', b.ref)
        .executeTakeFirst();
      if (dup)
        throw conflict('contract-ref', 'This customer already has a contract with that reference');
      const c = await tx
        .insertInto('contract')
        .values({
          org_id: b.orgId,
          ref: b.ref,
          title: b.title,
          value_inr: b.valueInr,
          starts_on: b.startsOn,
          ends_on: b.endsOn,
          owner_id: b.ownerId ?? null,
          created_by: p.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'contract.create',
          orgId: b.orgId,
          targetType: 'contract',
          targetId: c.id,
          diff: { ref: b.ref },
        },
      );
      return (await this.load(tx, { id: c.id }, true))[0]!;
    });
  }

  @Put('admin/contracts/:id')
  @RequirePermission('contract:manage')
  async update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, raw);
    const b = parse(ContractUpsert, body);
    if (b.endsOn < b.startsOn)
      throw unprocessable('dates', 'The end date is before the start date');
    return this.db.withTenant(p, async (tx) => {
      await this.checkOwner(tx, b.ownerId);
      const r = await tx
        .updateTable('contract')
        .set({
          ref: b.ref,
          title: b.title,
          value_inr: b.valueInr,
          starts_on: b.startsOn,
          ends_on: b.endsOn,
          owner_id: b.ownerId ?? null,
        })
        .where('id', '=', id)
        .where('org_id', '=', b.orgId)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Contract');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'contract.update',
          orgId: b.orgId,
          targetType: 'contract',
          targetId: id,
          diff: { ref: b.ref },
        },
      );
      return (await this.load(tx, { id }, true))[0]!;
    });
  }

  @Post('admin/contracts/:id/invoices')
  @RequirePermission('contract:manage')
  async invoice(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, raw);
    const b = parse(InvoiceCreate, body);
    if (b.dueOn < b.issuedOn) throw unprocessable('dates', 'The due date is before the issue date');
    return this.db.withTenant(p, async (tx) => {
      const c = await tx
        .selectFrom('contract')
        .select('org_id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!c) throw notFound('Contract');
      const dup = await tx
        .selectFrom('invoice')
        .select('id')
        .where('number', '=', b.number)
        .executeTakeFirst();
      if (dup) throw conflict('invoice-number', 'An invoice with this number already exists');
      const i = await tx
        .insertInto('invoice')
        .values({
          contract_id: id,
          org_id: c.org_id,
          number: b.number,
          issued_on: b.issuedOn,
          due_on: b.dueOn,
          amount_inr: b.amountInr,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'invoice.create',
          orgId: c.org_id,
          targetType: 'invoice',
          targetId: i.id,
          diff: { number: b.number },
        },
      );
      return (await this.load(tx, { id }, true))[0]!;
    });
  }

  @Post('admin/invoices/:id')
  @RequirePermission('contract:manage')
  async invoiceStatus(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, raw);
    const b = parse(InvoiceStatusUpdate, body);
    return this.db.withTenant(p, async (tx) => {
      const i = await tx
        .updateTable('invoice')
        .set(
          b.status === 'paid'
            ? { status: 'paid', paid_on: b.paidOn }
            : { status: 'cancelled', paid_on: null },
        )
        .where('id', '=', id)
        .where('status', '=', 'issued')
        .returning(['contract_id', 'org_id'])
        .executeTakeFirst();
      if (!i)
        throw conflict('invoice-closed', 'Only an unpaid invoice can be marked paid or cancelled');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: `invoice.${b.status}`,
          orgId: i.org_id,
          targetType: 'invoice',
          targetId: id,
          diff: {},
        },
      );
      return (await this.load(tx, { id: i.contract_id }, true))[0]!;
    });
  }

  // ------------------------------------------------------------------ renewal pipeline
  @Get('workspace/renewals')
  @RequirePermission('contract:manage')
  pipeline(
    @CurrentPrincipal() p: Principal,
    @Query('days') rawDays?: string,
  ): Promise<RenewalPipeline> {
    const days = z.coerce
      .number()
      .int()
      .min(7)
      .max(365)
      .parse(rawDays ?? 90);
    return this.db.withTenant(p, (tx) => renewalPipeline(tx, days));
  }

  @Put('workspace/renewals/:id')
  @RequirePermission('contract:manage')
  async stage(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const id = parse(Id, raw);
    const b = parse(RenewalStageUpdate, body);
    await this.db.withTenant(p, async (tx) => {
      if (b.ownerId !== undefined) await this.checkOwner(tx, b.ownerId);
      const r = await tx
        .updateTable('contract')
        .set({
          renewal_stage: b.stage,
          renewal_updated_at: new Date(),
          ...(b.note !== undefined ? { renewal_note: b.note || null } : {}),
          ...(b.ownerId !== undefined ? { owner_id: b.ownerId } : {}),
        })
        .where('id', '=', id)
        .returning('org_id')
        .executeTakeFirst();
      if (!r) throw notFound('Contract');
      // A decision closes the customer's open request for this contract.
      if (b.stage === 'won' || b.stage === 'lost')
        await tx
          .updateTable('renewal_request')
          .set({ status: b.stage })
          .where('contract_id', '=', id)
          .where('status', '=', 'requested')
          .execute();
      if (b.stage === 'quoted')
        await tx
          .updateTable('renewal_request')
          .set({ status: 'quoted' })
          .where('contract_id', '=', id)
          .where('status', '=', 'requested')
          .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'contract.renewal_stage',
          orgId: r.org_id,
          targetType: 'contract',
          targetId: id,
          diff: { stage: b.stage },
        },
      );
    });
    return { ok: true };
  }
}

/**
 * Contracts ending in the next `days` (or ended in the last 30 without a decision), plus coverage
 * that has no contract record, grouped per customer. Shared by the page and the weekly digest.
 */
export async function renewalPipeline(tx: Tx, days: number): Promise<RenewalPipeline> {
  const today = istToday();
  const contracts = await sql<{
    id: string;
    org_id: string;
    org_name: string;
    ref: string;
    title: string;
    value_inr: string;
    ends_on: string;
    owner_id: string | null;
    owner_name: string | null;
    renewal_stage: RenewalStage;
    renewal_note: string | null;
    devices: string;
    asked: boolean;
  }>`
    SELECT c.id, c.org_id, o.name AS org_name, c.ref, c.title, c.value_inr,
           to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on, c.owner_id, u.display_name AS owner_name,
           c.renewal_stage, c.renewal_note,
           (SELECT count(DISTINCT e.asset_id) FROM entitlement e
             WHERE e.org_id = c.org_id AND e.contract_ref = c.ref) AS devices,
           EXISTS (SELECT 1 FROM renewal_request r WHERE r.contract_id = c.id AND r.status = 'requested') AS asked
      FROM contract c
      JOIN organization o ON o.id = c.org_id
      LEFT JOIN app_user u ON u.id = c.owner_id
     WHERE c.ends_on <= ${today}::date + ${days}::int
       AND (c.ends_on >= ${today}::date - 30 OR c.renewal_stage NOT IN ('won', 'lost'))
       AND c.ends_on >= ${today}::date - 365
     ORDER BY c.ends_on, o.name`.execute(tx);
  // Coverage with no contract record: one line per customer, by the earliest end date.
  const loose = await sql<{
    org_id: string;
    org_name: string;
    ends_on: string;
    devices: string;
    asked: boolean;
  }>`
    SELECT e.org_id, o.name AS org_name, to_char(min(e.ends_on), 'YYYY-MM-DD') AS ends_on,
           count(DISTINCT e.asset_id) AS devices,
           bool_or(EXISTS (SELECT 1 FROM renewal_request r WHERE r.asset_id = e.asset_id AND r.status = 'requested')) AS asked
      FROM entitlement e
      JOIN organization o ON o.id = e.org_id AND o.status = 'active'
     WHERE e.ends_on BETWEEN ${today}::date AND ${today}::date + ${days}::int
       AND NOT EXISTS (SELECT 1 FROM entitlement n WHERE n.asset_id = e.asset_id AND n.ends_on > e.ends_on)
       AND NOT EXISTS (SELECT 1 FROM contract c WHERE c.org_id = e.org_id AND c.ref = e.contract_ref)
     GROUP BY e.org_id, o.name
     ORDER BY min(e.ends_on)`.execute(tx);
  const items: RenewalPipelineItem[] = [
    ...contracts.rows.map((c) => ({
      contractId: c.id,
      orgId: c.org_id,
      orgName: c.org_name,
      ref: c.ref,
      title: c.title,
      valueInr: Number(c.value_inr),
      endsOn: c.ends_on,
      daysLeft: daysBetween(today, c.ends_on),
      devices: Number(c.devices),
      ownerId: c.owner_id,
      ownerName: c.owner_name,
      stage: c.renewal_stage,
      note: c.renewal_note,
      customerAsked: c.asked,
    })),
    ...loose.rows.map((l) => ({
      contractId: null,
      orgId: l.org_id,
      orgName: l.org_name,
      ref: null,
      title: 'Coverage without a contract record',
      valueInr: null,
      endsOn: l.ends_on,
      daysLeft: daysBetween(today, l.ends_on),
      devices: Number(l.devices),
      ownerId: null,
      ownerName: null,
      stage: null,
      note: null,
      customerAsked: l.asked,
    })),
  ].sort((a, b) => a.endsOn.localeCompare(b.endsOn));
  const open = items.filter((i) => i.stage !== 'won' && i.stage !== 'lost');
  return {
    items,
    totals: {
      count: open.length,
      openValueInr: open.reduce((n, i) => n + (i.valueInr ?? 0), 0),
      wonValueInr: items
        .filter((i) => i.stage === 'won')
        .reduce((n, i) => n + (i.valueInr ?? 0), 0),
    },
  };
}
