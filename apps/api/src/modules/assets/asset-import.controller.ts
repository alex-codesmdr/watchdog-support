import { Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { IMPORT_COLUMNS, type ImportReport } from '@wd/contracts';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { audit } from '../../common/audit.js';
import { ProblemError, unprocessable } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import {
  ImportFileError,
  MAX_IMPORT_BYTES,
  readImportFile,
  toCsv,
  type RawRow,
} from './asset-import.js';

type RowResult = ImportReport['rows'][number];
const KINDS = ['warranty', 'amc', 'subscription'] as const;
const TIERS = ['standard', 'premium', 'mission_critical'] as const;
const TIER_ALIASES: Record<string, (typeof TIERS)[number]> = {
  'mission-critical': 'mission_critical',
  'mission critical': 'mission_critical',
  missioncritical: 'mission_critical',
};
const SERIAL = /^[A-Z0-9-]{6,32}$/;
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^[0-9a-f]{4}(\.[0-9a-f]{4}){2}$|^[0-9a-f]{12}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ymd = (d: Date | string | null) =>
  d === null
    ? null
    : d instanceof Date
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : String(d).slice(0, 10);

/** Accepts YYYY-MM-DD, DD-MM-YYYY and DD/MM/YYYY (the common Indian spreadsheet format). */
export function parseDate(v: string | undefined): string | null | 'invalid' {
  if (!v) return null;
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v)))
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return 'invalid';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
    return 'invalid';
  if (y < 2000 || y > 2100) return 'invalid';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface Lookups {
  orgsById: Map<string, { id: string; name: string }>;
  orgsByName: Map<string, { id: string; name: string }[]>;
  products: Map<string, string>;
  sites: Map<string, string>; // `${orgId}|${lower(name)}` → id
}

/**
 * Bulk device import for staff (CSV or Excel). Every row runs in its own savepoint so one bad row
 * never blocks the rest; a dry run executes the same logic and rolls everything back, so the
 * preview is exactly what a real import would do.
 */
@Controller('api/v1/admin/asset-imports')
export class AssetImportController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('template.csv')
  @RequirePermission('asset:import')
  async template(@Res() res: Response) {
    const sku = await this.db.withSystem((tx) =>
      tx.selectFrom('product').select('sku').orderBy('sku').limit(1).executeTakeFirst(),
    );
    const example = {
      organisation: 'Example Customer Pvt. Ltd.',
      serial_number: 'WD24A0000001',
      sku: sku?.sku ?? 'WD-S5130-28',
      site: 'Head Office',
      mac: '00:1a:2b:3c:4d:5e',
      purchase_date: '2026-01-15',
      software_version: '7.1.070',
      coverage_kind: 'warranty',
      coverage_tier: 'standard',
      coverage_start: '2026-01-15',
      coverage_end: '2029-01-14',
      contract_ref: 'PO-2026-0042',
    } satisfies Record<(typeof IMPORT_COLUMNS)[number], string>;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="watchdog-device-import-template.csv"',
    );
    res.send(toCsv([[...IMPORT_COLUMNS], IMPORT_COLUMNS.map((c) => example[c])]));
  }

  @Get()
  @RequirePermission('asset:import')
  async history(@CurrentPrincipal() p: Principal) {
    return this.db.withTenant(p, async (tx) => {
      const rows = await tx
        .selectFrom('asset_import as i')
        .innerJoin('app_user as u', 'u.id', 'i.uploaded_by')
        .select([
          'i.id',
          'i.file_name',
          'i.dry_run',
          'i.total_rows',
          'i.created',
          'i.updated',
          'i.failed',
          'i.created_at',
          'u.display_name',
        ])
        .orderBy('i.created_at', 'desc')
        .limit(50)
        .execute();
      return {
        items: rows.map((r) => ({
          id: r.id,
          fileName: r.file_name,
          dryRun: r.dry_run,
          totalRows: r.total_rows,
          created: r.created,
          updated: r.updated,
          failed: r.failed,
          uploadedBy: r.display_name,
          createdAt: r.created_at.toISOString(),
        })),
      };
    });
  }

  @Post()
  @RequirePermission('asset:import')
  @RateLimit('asset-import', 60, 3600)
  async upload(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Req() req: Request,
    @Query('dryRun') dryRunQ?: string,
    @Query('fileName') fileNameQ?: string,
  ): Promise<ImportReport> {
    const dryRun = dryRunQ !== 'false';
    const fileName = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .catch('upload')
      .parse(fileNameQ)
      .replace(/[^\w.\- ()]/g, '_');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw unprocessable('file', 'Upload a CSV or .xlsx file', 'The request body was empty.');
    if (body.length > MAX_IMPORT_BYTES)
      throw new ProblemError(413, 'file-too-large', 'The file is larger than 5 MB');
    let parsed: Awaited<ReturnType<typeof readImportFile>>;
    try {
      parsed = await readImportFile(body);
    } catch (e) {
      if (e instanceof ImportFileError)
        throw unprocessable('file', 'The file could not be imported', e.message);
      throw e;
    }

    return this.db.withTenant(p, async (tx) => {
      const lk = await this.lookups(tx);
      const results: RowResult[] = [];
      const seen = new Map<string, number>();
      await sql`SAVEPOINT import_all`.execute(tx);
      for (const raw of parsed.rows) {
        const serial = raw.values.serial_number?.toUpperCase() ?? null;
        if (serial && seen.has(serial)) {
          results.push({
            row: raw.row,
            serialNumber: serial,
            status: 'error',
            messages: [`Duplicate of row ${seen.get(serial)} in this file`],
          });
          continue;
        }
        if (serial) seen.set(serial, raw.row);
        await sql`SAVEPOINT import_row`.execute(tx);
        try {
          const r = await this.importRow(tx, lk, raw);
          if (r.status === 'error') await sql`ROLLBACK TO SAVEPOINT import_row`.execute(tx);
          else await sql`RELEASE SAVEPOINT import_row`.execute(tx);
          results.push(r);
        } catch (e) {
          await sql`ROLLBACK TO SAVEPOINT import_row`.execute(tx);
          const code = (e as { code?: string }).code;
          results.push({
            row: raw.row,
            serialNumber: serial,
            status: 'error',
            messages: [
              code === '23P01'
                ? 'The coverage dates overlap existing coverage of the same kind for this device'
                : code === '23505'
                  ? 'This serial number is already registered'
                  : 'The row could not be saved; check the values',
            ],
          });
        }
      }
      if (dryRun) await sql`ROLLBACK TO SAVEPOINT import_all`.execute(tx);
      else await sql`RELEASE SAVEPOINT import_all`.execute(tx);

      const count = (s: RowResult['status']) => results.filter((r) => r.status === s).length;
      const warnings = parsed.unknownColumns.length
        ? [
            {
              row: 1,
              serialNumber: null,
              status: 'unchanged' as const,
              messages: [`Ignored columns: ${parsed.unknownColumns.join(', ')}`],
            },
          ]
        : [];
      const report = {
        fileName,
        dryRun,
        totalRows: parsed.rows.length,
        created: count('created'),
        updated: count('updated'),
        unchanged: count('unchanged'),
        failed: count('error'),
        rows: [...warnings, ...results],
      };
      const rec = await tx
        .insertInto('asset_import')
        .values({
          uploaded_by: p.userId,
          file_name: fileName,
          dry_run: dryRun,
          total_rows: report.totalRows,
          created: report.created,
          updated: report.updated,
          failed: report.failed,
          report: JSON.stringify(report.rows),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (!dryRun)
        await audit(
          tx,
          { ...ctx, actorId: p.userId },
          {
            action: 'asset.import',
            orgId: null,
            targetType: 'asset_import',
            targetId: rec.id,
            diff: { created: report.created, updated: report.updated, failed: report.failed },
          },
        );
      return { id: rec.id, ...report };
    });
  }

  private async lookups(tx: Tx): Promise<Lookups> {
    const orgs = await tx
      .selectFrom('organization')
      .select(['id', 'name'])
      .where('org_type', '!=', 'internal')
      .execute();
    const orgsByName = new Map<string, { id: string; name: string }[]>();
    for (const o of orgs) {
      const k = o.name.trim().toLowerCase();
      orgsByName.set(k, [...(orgsByName.get(k) ?? []), o]);
    }
    const products = await tx.selectFrom('product').select(['id', 'sku']).execute();
    const sites = await tx.selectFrom('site').select(['id', 'org_id', 'name']).execute();
    return {
      orgsById: new Map(orgs.map((o) => [o.id, o])),
      orgsByName,
      products: new Map(products.map((x) => [x.sku.toUpperCase(), x.id])),
      sites: new Map(sites.map((s) => [`${s.org_id}|${s.name.toLowerCase()}`, s.id])),
    };
  }

  private async importRow(tx: Tx, lk: Lookups, raw: RawRow): Promise<RowResult> {
    const v = raw.values;
    const msgs: string[] = [];
    const serial = v.serial_number?.toUpperCase() ?? null;
    const fail = (...m: string[]): RowResult => ({
      row: raw.row,
      serialNumber: serial,
      status: 'error',
      messages: m,
    });

    // --- validate ---------------------------------------------------------------------------
    let orgId: string | undefined;
    if (!v.organisation) msgs.push('Organisation is required');
    else if (UUID.test(v.organisation)) {
      orgId = lk.orgsById.get(v.organisation.toLowerCase())?.id;
      if (!orgId) msgs.push('No customer organisation has this ID');
    } else {
      const m = lk.orgsByName.get(v.organisation.toLowerCase()) ?? [];
      if (m.length === 1) orgId = m[0]!.id;
      else if (m.length > 1)
        msgs.push('More than one organisation has this name; use the organisation ID');
      else msgs.push(`No customer organisation is named "${v.organisation}"`);
    }
    if (!serial) msgs.push('Serial number is required');
    else if (!SERIAL.test(serial))
      msgs.push('Serial number must be 6–32 letters, digits or hyphens');
    const productId = v.sku ? lk.products.get(v.sku.toUpperCase()) : undefined;
    if (!v.sku) msgs.push('SKU is required');
    else if (!productId) msgs.push(`Unknown SKU "${v.sku}"`);
    if (v.mac && !MAC.test(v.mac)) msgs.push('MAC address is not valid');
    const purchase = parseDate(v.purchase_date);
    if (purchase === 'invalid') msgs.push('Purchase date must look like 2026-01-31 or 31/01/2026');
    if (v.software_version && v.software_version.length > 64)
      msgs.push('Software version is too long');
    if (v.site && v.site.length > 120) msgs.push('Site name is too long');

    const hasCoverage = Boolean(
      v.coverage_kind || v.coverage_tier || v.coverage_start || v.coverage_end,
    );
    const kind = v.coverage_kind?.toLowerCase() as (typeof KINDS)[number] | undefined;
    const tierRaw = v.coverage_tier?.toLowerCase();
    const tier = (tierRaw && (TIER_ALIASES[tierRaw] ?? tierRaw)) as
      (typeof TIERS)[number] | undefined;
    const start = parseDate(v.coverage_start);
    const end = parseDate(v.coverage_end);
    if (hasCoverage) {
      if (!kind || !KINDS.includes(kind))
        msgs.push('Coverage kind must be warranty, amc or subscription');
      if (!tier || !TIERS.includes(tier))
        msgs.push('Coverage tier must be standard, premium or mission_critical');
      if (!start || start === 'invalid') msgs.push('Coverage start date is missing or not valid');
      if (!end || end === 'invalid') msgs.push('Coverage end date is missing or not valid');
      if (start && end && start !== 'invalid' && end !== 'invalid' && end < start)
        msgs.push('Coverage ends before it starts');
    }
    if (v.contract_ref && v.contract_ref.length > 64) msgs.push('Contract reference is too long');
    if (msgs.length || !orgId || !serial || !productId) return fail(...msgs);

    // --- apply --------------------------------------------------------------------------------
    let siteId: string | null = null;
    if (v.site) {
      const key = `${orgId}|${v.site.toLowerCase()}`;
      siteId = lk.sites.get(key) ?? null;
      if (!siteId) {
        const s = await tx
          .insertInto('site')
          .values({ org_id: orgId, name: v.site })
          .returning('id')
          .executeTakeFirstOrThrow();
        siteId = s.id;
        lk.sites.set(key, siteId);
        msgs.push(`New site "${v.site}"`);
      }
    }
    const mac = v.mac
      ? v.mac
          .replace(/[^0-9a-f]/gi, '')
          .toLowerCase()
          .replace(/(..)(?!$)/g, '$1:')
      : null;

    const existing = await tx
      .selectFrom('asset')
      .select(['id', 'org_id', 'product_id', 'site_id', 'mac', 'purchase_date', 'current_version'])
      .where('serial_number', '=', serial)
      .executeTakeFirst();
    let status: RowResult['status'];
    let assetId: string;
    if (!existing) {
      const a = await tx
        .insertInto('asset')
        .values({
          org_id: orgId,
          product_id: productId,
          serial_number: serial,
          site_id: siteId,
          mac,
          purchase_date: purchase as string | null,
          current_version: v.software_version ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      assetId = a.id;
      status = 'created';
    } else {
      // Never move a device between customers by spreadsheet; that is an RMA/transfer decision.
      if (existing.org_id !== orgId)
        return fail('This serial number is registered to a different organisation');
      if (existing.product_id !== productId)
        return fail('This serial number is registered as a different SKU');
      assetId = existing.id;
      const patch: Record<string, string | null> = {};
      if (siteId && siteId !== existing.site_id) patch.site_id = siteId;
      if (mac && mac !== existing.mac) patch.mac = mac;
      if (purchase && purchase !== ymd(existing.purchase_date)) patch.purchase_date = purchase;
      if (v.software_version && v.software_version !== existing.current_version)
        patch.current_version = v.software_version;
      if (Object.keys(patch).length) {
        await tx.updateTable('asset').set(patch).where('id', '=', assetId).execute();
        msgs.push(
          `Updated ${Object.keys(patch)
            .map((k) => k.replace('_id', '').replace('current_', ''))
            .join(', ')}`,
        );
        status = 'updated';
      } else status = 'unchanged';
    }

    if (hasCoverage) {
      const same = await tx
        .selectFrom('entitlement')
        .select(['id', 'tier', 'contract_ref'])
        .where('asset_id', '=', assetId)
        .where('kind', '=', kind!)
        .where('starts_on', '=', start as string)
        .where('ends_on', '=', end as string)
        .executeTakeFirst();
      if (!same) {
        await tx
          .insertInto('entitlement')
          .values({
            org_id: orgId,
            asset_id: assetId,
            kind: kind!,
            tier: tier!,
            starts_on: start as string,
            ends_on: end as string,
            contract_ref: v.contract_ref ?? null,
          })
          .execute();
        msgs.push(`Coverage ${kind} ${start} to ${end}`);
        if (status === 'unchanged') status = 'updated';
      } else if (same.tier !== tier || (v.contract_ref && v.contract_ref !== same.contract_ref)) {
        await tx
          .updateTable('entitlement')
          .set({ tier: tier!, contract_ref: v.contract_ref ?? same.contract_ref })
          .where('id', '=', same.id)
          .execute();
        msgs.push('Coverage tier or contract updated');
        if (status === 'unchanged') status = 'updated';
      }
    }
    return { row: raw.row, serialNumber: serial, status, messages: msgs };
  }
}
