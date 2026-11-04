import { Controller, Get, Inject, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { SlaReportQuery, type SlaReport } from '@wd/contracts';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import type { Principal } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

/** SLA compliance and breach report for support management (design §6.5). */
@Controller('api/v1/reports/sla')
export class SlaReportController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @RequirePermission('report:sla:read')
  async report(@CurrentPrincipal() p: Principal, @Query() q: unknown): Promise<SlaReport> {
    const { from, to } = parse(SlaReportQuery, q);
    const toDate = to ?? new Date().toISOString().slice(0, 10);
    const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    return this.db.withTenant(p, async (tx) => {
      // Cases opened in [from, to] (IST calendar days).
      const inRange = sql<boolean>`(c.opened_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${fromDate}::date AND ${toDate}::date`;
      const rows = await tx
        .selectFrom('sla_clock as k')
        .innerJoin('support_case as c', 'c.id', 'k.case_id')
        .select([
          sql<string>`coalesce(c.tier, 'standard')`.as('tier'),
          'c.severity',
          'k.metric',
          sql<string>`count(*)`.as('total'),
          sql<string>`count(*) FILTER (WHERE k.met_at IS NOT NULL AND k.breached_at IS NULL)`.as(
            'met',
          ),
          sql<string>`count(*) FILTER (WHERE k.breached_at IS NOT NULL)`.as('breached'),
          sql<string>`count(*) FILTER (WHERE k.met_at IS NULL AND k.breached_at IS NULL)`.as(
            'running',
          ),
        ])
        .where(inRange)
        .groupBy([sql`coalesce(c.tier, 'standard')`, 'c.severity', 'k.metric'])
        .orderBy(sql`coalesce(c.tier, 'standard')`)
        .orderBy('c.severity')
        .orderBy('k.metric')
        .execute();
      const breaches = await tx
        .selectFrom('sla_clock as k')
        .innerJoin('support_case as c', 'c.id', 'k.case_id')
        .innerJoin('organization as o', 'o.id', 'c.org_id')
        .leftJoin('app_user as a', 'a.id', 'c.assignee_id')
        .select([
          'c.number',
          'c.subject',
          'o.name as org_name',
          'c.severity',
          'c.tier',
          'k.metric',
          'k.due_at',
          'k.breached_at',
          'k.met_at',
          'a.display_name as assignee',
          'c.support_level',
        ])
        .where('k.breached_at', 'is not', null)
        .where(inRange)
        .orderBy('k.breached_at', 'desc')
        .limit(200)
        .execute();
      const decided = rows.reduce((n, r) => n + Number(r.met) + Number(r.breached), 0);
      const metTotal = rows.reduce((n, r) => n + Number(r.met), 0);
      return {
        from: fromDate,
        to: toDate,
        overallCompliancePct: decided ? Math.round((metTotal / decided) * 1000) / 10 : null,
        rows: rows.map((r) => {
          const d = Number(r.met) + Number(r.breached);
          return {
            tier: r.tier as SlaReport['rows'][number]['tier'],
            severity: r.severity,
            metric: r.metric,
            total: Number(r.total),
            met: Number(r.met),
            breached: Number(r.breached),
            running: Number(r.running),
            compliancePct: d ? Math.round((Number(r.met) / d) * 1000) / 10 : null,
          };
        }),
        breaches: breaches.map((b) => ({
          caseNumber: b.number,
          subject: b.subject,
          orgName: b.org_name,
          severity: b.severity,
          tier: (b.tier ?? 'standard') as SlaReport['rows'][number]['tier'],
          metric: b.metric,
          dueAt: b.due_at.toISOString(),
          breachedAt: b.breached_at!.toISOString(),
          metAt: b.met_at?.toISOString() ?? null,
          assigneeName: b.assignee,
          supportLevel: b.support_level,
        })),
      };
    });
  }
}
