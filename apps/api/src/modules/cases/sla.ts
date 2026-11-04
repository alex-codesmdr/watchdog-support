import { sql } from 'kysely';
import type { SlaClockView } from '@wd/contracts';
import {
  addBusinessMinutes,
  businessMsBetween,
  evaluate,
  type BusinessCalendar,
} from '@wd/sla-time';
import type { Tx } from '../../db/database.js';

export type Metric = SlaClockView['metric'];

export interface ResolvedPolicy {
  policyId: string;
  targets: {
    first_response: number;
    update: number;
    restoration: number | null;
    resolution: number;
  };
  calendar: BusinessCalendar;
}

/** Active policy for a tier + its targets for a severity, with a calendar snapshot (incl. holidays). */
export async function resolvePolicy(
  tx: Tx,
  tier: string,
  severity: string,
): Promise<ResolvedPolicy | null> {
  const row = await tx
    .selectFrom('sla_policy as p')
    .innerJoin('sla_target as t', 't.policy_id', 'p.id')
    .innerJoin('business_calendar as c', 'c.id', 'p.calendar_id')
    .select([
      'p.id as policyId',
      't.first_response_min',
      't.update_every_min',
      't.restoration_min',
      't.resolution_min',
      't.round_the_clock',
      'c.id as calendarId',
      'c.time_zone',
      'c.twenty_four_seven',
      'c.weekly',
    ])
    .where('p.tier', '=', tier)
    .where('p.active', '=', true)
    .where('t.severity', '=', severity)
    .executeTakeFirst();
  if (!row) return null;
  const holidays = (
    await tx
      .selectFrom('calendar_holiday')
      .select(sql<string>`to_char(day, 'YYYY-MM-DD')`.as('d'))
      .where('calendar_id', '=', row.calendarId)
      .execute()
  ).map((h) => h.d);
  const calendar: BusinessCalendar =
    row.round_the_clock || row.twenty_four_seven
      ? { timeZone: row.time_zone, twentyFourSeven: true, weekly: {} }
      : { timeZone: row.time_zone, weekly: row.weekly as BusinessCalendar['weekly'], holidays };
  return {
    policyId: row.policyId,
    targets: {
      first_response: row.first_response_min,
      update: row.update_every_min,
      restoration: row.restoration_min,
      resolution: row.resolution_min,
    },
    calendar,
  };
}

export async function startClocks(
  tx: Tx,
  caseId: string,
  at: Date,
  pol: ResolvedPolicy,
  withRestoration: boolean,
): Promise<void> {
  const metrics: Array<[Metric, number]> = [
    ['first_response', pol.targets.first_response],
    ['resolution', pol.targets.resolution],
  ];
  if (withRestoration && pol.targets.restoration)
    metrics.push(['restoration', pol.targets.restoration]);
  for (const [metric, minutes] of metrics) {
    await tx
      .insertInto('sla_clock')
      .values({
        case_id: caseId,
        metric,
        target_minutes: minutes,
        calendar: JSON.stringify(pol.calendar),
        started_at: at,
        due_at: addBusinessMinutes(at, minutes, pol.calendar),
      } as never)
      .execute();
  }
}

/** Starts or re-arms the rolling "update every N" clock (on each public staff reply). */
export async function rearmUpdateClock(
  tx: Tx,
  caseId: string,
  at: Date,
  pol: ResolvedPolicy,
): Promise<void> {
  const due = addBusinessMinutes(at, pol.targets.update, pol.calendar);
  await tx
    .insertInto('sla_clock')
    .values({
      case_id: caseId,
      metric: 'update',
      target_minutes: pol.targets.update,
      calendar: JSON.stringify(pol.calendar),
      started_at: at,
      due_at: due,
    } as never)
    .onConflict((oc) =>
      oc
        .columns(['case_id', 'metric'])
        .doUpdateSet({
          started_at: at,
          due_at: due,
          paused_ms: 0,
          paused_at: null,
          met_at: null,
          breached_at: null,
          last_warn_pct: 0,
        } as never),
    )
    .execute();
}

export async function markMet(tx: Tx, caseId: string, metrics: Metric[], at: Date): Promise<void> {
  if (!metrics.length) return;
  await tx
    .updateTable('sla_clock')
    .set({ met_at: at, paused_at: null })
    .where('case_id', '=', caseId)
    .where('metric', 'in', metrics)
    .where('met_at', 'is', null)
    .execute();
}

export async function unmet(tx: Tx, caseId: string, metrics: Metric[]): Promise<void> {
  await tx
    .updateTable('sla_clock')
    .set({ met_at: null })
    .where('case_id', '=', caseId)
    .where('metric', 'in', metrics)
    .execute();
}

export async function pauseAll(tx: Tx, caseId: string, at: Date): Promise<void> {
  await tx
    .updateTable('sla_clock')
    .set({ paused_at: at })
    .where('case_id', '=', caseId)
    .where('met_at', 'is', null)
    .where('paused_at', 'is', null)
    .execute();
}

export async function resumeAll(tx: Tx, caseId: string, at: Date): Promise<void> {
  const clocks = await tx
    .selectFrom('sla_clock')
    .selectAll()
    .where('case_id', '=', caseId)
    .where('paused_at', 'is not', null)
    .execute();
  for (const c of clocks) {
    const cal = c.calendar as unknown as BusinessCalendar;
    const pausedMs = Number(c.paused_ms) + businessMsBetween(c.paused_at!, at, cal);
    const due = addBusinessMinutes(c.started_at, c.target_minutes + pausedMs / 60_000, cal);
    await tx
      .updateTable('sla_clock')
      .set({ paused_at: null, paused_ms: pausedMs, due_at: due })
      .where('id', '=', c.id)
      .execute();
  }
}

export interface ClockRow {
  metric: Metric;
  target_minutes: number;
  calendar: unknown;
  started_at: Date;
  paused_ms: string | number;
  paused_at: Date | null;
  met_at: Date | null;
  breached_at: Date | null;
}

export function toView(c: ClockRow, now = new Date()): SlaClockView {
  const cal = c.calendar as BusinessCalendar;
  const e = evaluate(
    {
      startedAt: c.started_at,
      targetMinutes: c.target_minutes,
      pausedMs: Number(c.paused_ms),
      pausedAt: c.paused_at,
      metAt: c.met_at,
    },
    cal,
    now,
  );
  return {
    metric: c.metric,
    dueAt: e.dueAt.toISOString(),
    metAt: c.met_at?.toISOString() ?? null,
    // Breach is recorded by the SLA worker (Phase 3); until then the UI derives it from remainingSeconds < 0.
    breachedAt: c.breached_at?.toISOString() ?? null,
    paused: c.paused_at !== null,
    remainingSeconds: e.remainingSeconds,
    percentElapsed: e.percentElapsed,
  };
}

const ORDER: Metric[] = ['first_response', 'restoration', 'update', 'resolution'];
export const sortClocks = (v: SlaClockView[]) =>
  [...v].sort((a, b) => ORDER.indexOf(a.metric) - ORDER.indexOf(b.metric));

/** The most urgent running clock (for list badges). */
export function nextClock(views: SlaClockView[]): SlaClockView | null {
  const open = views.filter((v) => !v.metAt);
  if (!open.length) return null;
  return open.reduce((a, b) => (a.remainingSeconds <= b.remainingSeconds ? a : b));
}
