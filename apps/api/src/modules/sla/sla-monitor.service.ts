import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { crossedThreshold, evaluate, type BusinessCalendar } from '@wd/sla-time';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { logger } from '../../common/logger.js';
import { emit } from '../../common/outbox.js';

export interface SlaTickResult {
  scanned: number;
  warnings: number;
  breaches: number;
  escalations: number;
}

type Action = 'notify_assignee' | 'notify_managers' | 'notify_matrix' | 'escalate_level';

/**
 * SLA monitor (design §6.4). Each tick scans running clocks (not met, not paused, not yet at 100 %),
 * evaluates business-time elapsed, and for each newly crossed threshold (50/75/90/100):
 *   - advances last_warn_pct with compare-and-set (idempotent across workers and retries),
 *   - stamps breached_at at 100 %,
 *   - applies matching escalation rules (notify / escalate support level),
 *   - records an internal case event and emits `sla.warning` / `sla.breached` for notifications.
 * Paused clocks (Awaiting Customer) are skipped, so they can never breach.
 */
@Injectable()
export class SlaMonitorService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async tick(now: Date = new Date(), batch = 500): Promise<SlaTickResult> {
    const result: SlaTickResult = { scanned: 0, warnings: 0, breaches: 0, escalations: 0 };
    await this.db.withSystem(async (tx) => {
      const clocks = await tx
        .selectFrom('sla_clock as k')
        .innerJoin('support_case as c', 'c.id', 'k.case_id')
        .select([
          'k.id',
          'k.case_id',
          'k.org_id',
          'k.metric',
          'k.target_minutes',
          'k.calendar',
          'k.started_at',
          'k.paused_ms',
          'k.last_warn_pct',
          'c.number',
          'c.tier',
          'c.severity',
          'c.support_level',
          'c.status',
        ])
        .where('k.met_at', 'is', null)
        .where('k.paused_at', 'is', null)
        .where('k.last_warn_pct', '<', 100)
        .where('k.started_at', '<=', now)
        .where('c.status', 'not in', ['resolved', 'closed'])
        .orderBy('k.due_at')
        .limit(batch)
        .forUpdate('k')
        .skipLocked()
        .execute();
      if (!clocks.length) return;
      const rules = await tx
        .selectFrom('escalation_rule')
        .selectAll()
        .where('active', '=', true)
        .execute();

      for (const k of clocks) {
        result.scanned++;
        const e = evaluate(
          {
            startedAt: k.started_at,
            targetMinutes: k.target_minutes,
            pausedMs: Number(k.paused_ms),
            pausedAt: null,
            metAt: null,
          },
          k.calendar as unknown as BusinessCalendar,
          now,
        );
        const t = crossedThreshold(e.percentElapsed, k.last_warn_pct);
        if (t === null) continue;

        const upd = await tx
          .updateTable('sla_clock')
          .set({ last_warn_pct: t, ...(t === 100 ? { breached_at: e.dueAt } : {}) })
          .where('id', '=', k.id)
          .where('last_warn_pct', '=', k.last_warn_pct)
          .executeTakeFirst();
        if (!upd.numUpdatedRows) continue; // another worker got there first

        const actions = [
          ...new Set(
            rules
              .filter(
                (r) =>
                  r.threshold === t &&
                  (!r.tier || r.tier === k.tier) &&
                  (!r.severity || r.severity === k.severity) &&
                  (!r.metric || r.metric === k.metric),
              )
              .map((r) => r.action as Action),
          ),
        ];
        let escalatedTo: number | null = null;
        if (actions.includes('escalate_level') && k.support_level < 4) {
          escalatedTo = await this.escalate(tx, k.case_id, k.support_level, k.metric);
          if (escalatedTo) result.escalations++;
        }
        await tx
          .insertInto('case_event')
          .values({
            case_id: k.case_id,
            type: t === 100 ? 'sla_breached' : 'sla_warning',
            visibility: 'internal',
            actor_id: null,
            data: JSON.stringify({ metric: k.metric, threshold: t, escalatedTo }),
          } as never)
          .execute();
        await emit(tx, t === 100 ? 'sla.breached' : 'sla.warning', k.org_id, {
          caseId: k.case_id,
          number: k.number,
          metric: k.metric,
          threshold: t,
          actions,
          escalatedTo,
        });
        if (t === 100) result.breaches++;
        else result.warnings++;
      }
    });
    if (result.warnings || result.breaches) logger.info(result, 'SLA tick');
    return result;
  }

  /** Raises the support level (L1→L2→L3→Engineering), clears the assignee, re-queues. */
  private async escalate(
    tx: Tx,
    caseId: string,
    from: number,
    metric: string,
  ): Promise<number | null> {
    const to = Math.min(from + 1, 4);
    const queue = await tx
      .selectFrom('queue')
      .select('id')
      .where('support_level', '=', to)
      .executeTakeFirst();
    const r = await tx
      .updateTable('support_case')
      .set({
        support_level: to,
        queue_id: queue?.id ?? null,
        assignee_id: null,
        version: sql`version + 1`,
      })
      .where('id', '=', caseId)
      .where('support_level', '=', from)
      .executeTakeFirst();
    if (!r.numUpdatedRows) return null;
    await tx
      .insertInto('case_event')
      .values({
        case_id: caseId,
        type: 'escalated',
        visibility: 'public',
        actor_id: null,
        data: JSON.stringify({ fromLevel: from, toLevel: to, reason: `sla_breach:${metric}` }),
      } as never)
      .execute();
    return to;
  }

  /** Runs `tick` on an interval (worker). Safe with several workers: rows are locked and CAS-updated. */
  start(intervalMs = 30_000): () => void {
    let running = false;
    const id = setInterval(() => {
      if (running) return;
      running = true;
      this.tick()
        .catch((err) => logger.error({ err }, 'SLA tick failed'))
        .finally(() => (running = false));
    }, intervalMs);
    return () => clearInterval(id);
  }
}
