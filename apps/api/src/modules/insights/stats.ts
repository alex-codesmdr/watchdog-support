import { sql } from 'kysely';
import type { Tx } from '../../db/database.js';

const IST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
});

/** First day (YYYY-MM-01) of the month `now` falls in, in India time, shifted by `offset` months. */
export function monthStart(now: Date, offset = 0): string {
  const [y, m] = IST.format(now).split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** The first days of the last `n` months, oldest first, ending with the current month. */
export const monthsBack = (now: Date, n: number) =>
  Array.from({ length: n }, (_, i) => monthStart(now, i - n + 1));

/** Share of decided SLA clocks that were met, to one decimal place. */
export const slaPct = (met: number, breached: number) =>
  met + breached ? Math.round((met / (met + breached)) * 1000) / 10 : null;

export interface MonthStats {
  opened: number;
  resolved: number;
  openNow: number;
  medianFirstResponseMinutes: number | null;
  slaMetPct: number | null;
  csatAverage: number | null;
  csatResponses: number;
  expiringSoon: number;
}

/** One organisation's support in one month [from, to): the figures in the monthly review email. */
export async function monthStats(
  tx: Tx,
  orgId: string,
  from: string,
  to: string,
): Promise<MonthStats> {
  const r = await sql<{
    opened: string;
    resolved: string;
    open_now: string;
    frt: string | null;
    met: string;
    breached: string;
    csat: string | null;
    csat_n: string;
    expiring: string;
  }>`
    SELECT
      (SELECT count(*) FROM support_case WHERE org_id = ${orgId} AND merged_into_id IS NULL
          AND opened_at >= ${from}::date AND opened_at < ${to}::date) AS opened,
      (SELECT count(*) FROM support_case WHERE org_id = ${orgId} AND merged_into_id IS NULL
          AND resolved_at >= ${from}::date AND resolved_at < ${to}::date) AS resolved,
      (SELECT count(*) FROM support_case WHERE org_id = ${orgId} AND merged_into_id IS NULL
          AND status NOT IN ('resolved', 'closed')) AS open_now,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_responded_at - opened_at) / 60)
         FROM support_case WHERE org_id = ${orgId} AND first_responded_at IS NOT NULL
          AND opened_at >= ${from}::date AND opened_at < ${to}::date) AS frt,
      (SELECT count(*) FROM sla_clock k JOIN support_case c ON c.id = k.case_id
        WHERE c.org_id = ${orgId} AND c.opened_at >= ${from}::date AND c.opened_at < ${to}::date
          AND k.met_at IS NOT NULL AND k.breached_at IS NULL) AS met,
      (SELECT count(*) FROM sla_clock k JOIN support_case c ON c.id = k.case_id
        WHERE c.org_id = ${orgId} AND c.opened_at >= ${from}::date AND c.opened_at < ${to}::date
          AND k.breached_at IS NOT NULL) AS breached,
      (SELECT avg(score) FROM csat_response WHERE org_id = ${orgId}
          AND created_at >= ${from}::date AND created_at < ${to}::date) AS csat,
      (SELECT count(*) FROM csat_response WHERE org_id = ${orgId}
          AND created_at >= ${from}::date AND created_at < ${to}::date) AS csat_n,
      (SELECT count(DISTINCT e.asset_id) FROM entitlement e
        WHERE e.org_id = ${orgId} AND e.ends_on BETWEEN current_date AND current_date + 60
          AND NOT EXISTS (SELECT 1 FROM entitlement n WHERE n.asset_id = e.asset_id AND n.ends_on > e.ends_on)) AS expiring`.execute(
    tx,
  );
  const x = r.rows[0]!;
  return {
    opened: Number(x.opened),
    resolved: Number(x.resolved),
    openNow: Number(x.open_now),
    medianFirstResponseMinutes: x.frt === null ? null : Math.round(Number(x.frt)),
    slaMetPct: slaPct(Number(x.met), Number(x.breached)),
    csatAverage: x.csat === null ? null : Math.round(Number(x.csat) * 10) / 10,
    csatResponses: Number(x.csat_n),
    expiringSoon: Number(x.expiring),
  };
}
