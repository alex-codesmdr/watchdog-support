import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql, type SqlBool } from 'kysely';
import { OpsReportQuery, SEVERITY_LABELS, type OpsReport } from '@wd/contracts';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { forbidden } from '../../common/errors.js';
import { has, type Principal } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const CATEGORY: Record<string, string> = {
  hardware: 'Hardware',
  software: 'Software',
  config: 'Configuration',
  performance: 'Performance',
  security: 'Security',
  licensing: 'Licensing',
  documentation: 'Documentation',
};
const AGE: Array<[string, string, string]> = [
  ['lt1d', 'Under 1 day', `interval '1 day'`],
  ['1to3d', '1–3 days', `interval '3 days'`],
  ['3to7d', '3–7 days', `interval '7 days'`],
  ['7to30d', '7–30 days', `interval '30 days'`],
  ['gt30d', 'Over 30 days', `interval '100 years'`],
];
const istDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Operations report: volumes, speed, backlog and satisfaction. Customer administrators see their
 * own organisation; support managers see every customer or one at a time. All dates are IST.
 */
@Controller('api/v1/reports/operations')
export class OpsReportController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private scope(p: Principal, orgId?: string): string | null {
    if (has(p, 'report:ops:read:all')) return orgId ?? null;
    if (has(p, 'report:ops:read:org') && !p.isInternal) {
      if (orgId && orgId !== p.orgId) throw forbidden();
      return p.orgId;
    }
    throw forbidden();
  }

  private range(q: { from?: string; to?: string }) {
    const to = q.to ?? istDate(new Date());
    const from = q.from ?? istDate(new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000));
    return { from, to };
  }

  @Get()
  @RequirePermission('report:ops:read:org', 'report:ops:read:all')
  async report(@CurrentPrincipal() p: Principal, @Query() query: unknown): Promise<OpsReport> {
    const q = parse(OpsReportQuery, query);
    const org = this.scope(p, q.orgId);
    const { from, to } = this.range(q);
    return this.db.withTenant(p, async (tx) => {
      const opened = sql<SqlBool>`(c.opened_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`;
      const resolvedIn = sql<SqlBool>`(c.resolved_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`;
      const base = () => {
        const b = tx.selectFrom('support_case as c');
        return org ? b.where('c.org_id', '=', org) : b;
      };
      const one = async (qb: ReturnType<typeof base>, expr: ReturnType<typeof sql>) =>
        Number((await qb.select(expr.as('v')).executeTakeFirst())?.v ?? 0);

      const [nOpened, nResolved, nOpen] = await Promise.all([
        one(base().where(opened), sql`count(*)`),
        one(base().where(resolvedIn), sql`count(*)`),
        one(base().where('c.status', 'not in', ['resolved', 'closed']), sql`count(*)`),
      ]);
      const fr = await base()
        .innerJoin('sla_clock as k', (j) =>
          j.onRef('k.case_id', '=', 'c.id').on('k.metric', '=', 'first_response'),
        )
        .select(
          sql<
            string | null
          >`percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM k.met_at - k.started_at) / 60)`.as(
            'm',
          ),
        )
        .where(opened)
        .where('k.met_at', 'is not', null)
        .executeTakeFirst();
      const res = await base()
        .select(
          sql<
            string | null
          >`percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM c.resolved_at - c.opened_at) / 3600)`.as(
            'm',
          ),
        )
        .where(resolvedIn)
        .executeTakeFirst();
      const csat = await base()
        .innerJoin('csat_response as s', 's.case_id', 'c.id')
        .select([sql<string | null>`avg(s.score)`.as('avg'), sql<string>`count(*)`.as('n')])
        .where(
          sql<SqlBool>`(s.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`,
        )
        .executeTakeFirst();
      let rq = tx
        .selectFrom('rma as r')
        .select(sql<string>`count(*)`.as('n'))
        .where(
          sql<SqlBool>`(r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`,
        );
      if (org) rq = rq.where('r.org_id', '=', org);
      const rmas = Number((await rq.executeTakeFirst())?.n ?? 0);

      // Weeks start on Monday (IST); every week in range appears, including empty ones.
      const weekly = await sql<{ week: string; opened: string; resolved: string }>`
        WITH weeks AS (
          SELECT generate_series(date_trunc('week', ${from}::date), date_trunc('week', ${to}::date), interval '1 week')::date AS week
        ), scoped AS (
          SELECT opened_at, resolved_at FROM support_case WHERE ${org ? sql`org_id = ${org}` : sql`true`}
        )
        SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
               (SELECT count(*) FROM scoped s WHERE date_trunc('week', (s.opened_at AT TIME ZONE 'Asia/Kolkata'))::date = w.week
                  AND (s.opened_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date) AS opened,
               (SELECT count(*) FROM scoped s WHERE date_trunc('week', (s.resolved_at AT TIME ZONE 'Asia/Kolkata'))::date = w.week
                  AND (s.resolved_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date) AS resolved
          FROM weeks w ORDER BY w.week`.execute(tx);

      const sev = await base()
        .select(['c.severity', sql<string>`count(*)`.as('n')])
        .where(opened)
        .groupBy('c.severity')
        .execute();
      const cat = await base()
        .select(['c.category', sql<string>`count(*)`.as('n')])
        .where(opened)
        .groupBy('c.category')
        .execute();
      const fam = await base()
        .leftJoin('asset as a', 'a.id', 'c.asset_id')
        .leftJoin('product as pr', 'pr.id', 'a.product_id')
        .leftJoin('product_family as f', 'f.id', 'pr.family_id')
        .select([
          sql<string>`coalesce(f.key, 'none')`.as('k'),
          sql<string>`coalesce(f.name, 'No device')`.as('name'),
          sql<string>`count(*)`.as('n'),
        ])
        .where(opened)
        .groupBy([sql`coalesce(f.key, 'none')`, sql`coalesce(f.name, 'No device')`])
        .orderBy(sql`count(*)`, 'desc')
        .execute();
      const age = await base()
        .select(
          sql<string>`CASE ${sql.raw(
            AGE.map(([k, , iv]) => `WHEN now() - c.opened_at < ${iv} THEN '${k}'`).join(' '),
          )} END`.as('k'),
        )
        .select(sql<string>`count(*)`.as('n'))
        .where('c.status', 'not in', ['resolved', 'closed'])
        .groupBy(sql`1`)
        .execute();
      const top = org
        ? []
        : await tx
            .selectFrom('support_case as c')
            .innerJoin('organization as o', 'o.id', 'c.org_id')
            .select(['o.id', 'o.name', sql<string>`count(*)`.as('n')])
            .where(opened)
            .groupBy(['o.id', 'o.name'])
            .orderBy(sql`count(*)`, 'desc')
            .limit(10)
            .execute();
      const orgName = org
        ? ((
            await tx
              .selectFrom('organization')
              .select('name')
              .where('id', '=', org)
              .executeTakeFirst()
          )?.name ?? null)
        : null;
      const round = (v: string | null | undefined, d = 1) =>
        v === null || v === undefined ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;

      return {
        from,
        to,
        scope: { orgId: org, orgName },
        totals: {
          opened: nOpened,
          resolved: nResolved,
          openNow: nOpen,
          medianFirstResponseMinutes: round(fr?.m, 0),
          medianResolutionHours: round(res?.m),
          csatAverage: round(csat?.avg, 2),
          csatResponses: Number(csat?.n ?? 0),
          rmasOpened: rmas,
        },
        weekly: weekly.rows.map((w) => ({
          weekStart: w.week,
          opened: Number(w.opened),
          resolved: Number(w.resolved),
        })),
        bySeverity: (['P1', 'P2', 'P3', 'P4'] as const).map((k) => ({
          key: k,
          label: SEVERITY_LABELS[k].replace(/ \(.*\)$/, ''),
          count: Number(sev.find((x) => x.severity === k)?.n ?? 0),
        })),
        byFamily: fam.map((f) => ({ key: f.k, label: f.name, count: Number(f.n) })),
        byCategory: Object.entries(CATEGORY)
          .map(([k, label]) => ({
            key: k,
            label,
            count: Number(cat.find((x) => x.category === k)?.n ?? 0),
          }))
          .filter((x) => x.count > 0)
          .sort((a, b) => b.count - a.count),
        backlogAge: AGE.map(([k, label]) => ({
          key: k,
          label,
          count: Number(age.find((x) => x.k === k)?.n ?? 0),
        })),
        topOrganisations: top.map((o) => ({ key: o.id, label: o.name, count: Number(o.n) })),
      };
    });
  }

  /** Case-level CSV for the same scope and range (spreadsheet-safe). */
  @Get('cases.csv')
  @RequirePermission('report:ops:read:org', 'report:ops:read:all')
  @RateLimit('report-csv', 30, 3600)
  async csv(@CurrentPrincipal() p: Principal, @Query() query: unknown, @Res() res: Response) {
    const q = parse(OpsReportQuery, query);
    const org = this.scope(p, q.orgId);
    const { from, to } = this.range(q);
    const rows = await this.db.withTenant(p, (tx: Tx) => {
      let s = tx
        .selectFrom('support_case as c')
        .innerJoin('organization as o', 'o.id', 'c.org_id')
        .leftJoin('asset as a', 'a.id', 'c.asset_id')
        .leftJoin('product as pr', 'pr.id', 'a.product_id')
        .leftJoin('sla_clock as k', (j) =>
          j.onRef('k.case_id', '=', 'c.id').on('k.metric', '=', 'first_response'),
        )
        .leftJoin('csat_response as s', 's.case_id', 'c.id')
        .select([
          'c.number',
          sql<string>`to_char(c.opened_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`.as(
            'opened',
          ),
          'o.name as org',
          'c.severity',
          'c.status',
          'c.category',
          'pr.model_name',
          'a.serial_number',
          'c.subject',
          sql<string | null>`round(extract(epoch FROM k.met_at - k.started_at) / 60)`.as('frm'),
          sql<
            string | null
          >`to_char(c.resolved_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`.as(
            'resolved',
          ),
          's.score',
        ])
        .where(
          sql<SqlBool>`(c.opened_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`,
        )
        .orderBy('c.opened_at')
        .limit(50_000);
      if (org) s = s.where('c.org_id', '=', org);
      return s.execute();
    });
    const head = [
      'Case',
      'Opened (IST)',
      ...(org ? [] : ['Organisation']),
      'Severity',
      'Status',
      'Category',
      'Model',
      'Serial number',
      'Subject',
      'First response (minutes)',
      'Resolved (IST)',
      'Satisfaction (1-5)',
    ];
    const lines = rows.map((r) =>
      [
        r.number,
        r.opened,
        ...(org ? [] : [r.org]),
        r.severity,
        r.status,
        CATEGORY[r.category] ?? r.category,
        r.model_name,
        r.serial_number,
        r.subject,
        r.frm,
        r.resolved,
        r.score,
      ]
        .map(csvCell)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="watchdog-cases-${from}-to-${to}.csv"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(`\uFEFF${[head.join(','), ...lines].join('\r\n')}\r\n`);
  }
}
