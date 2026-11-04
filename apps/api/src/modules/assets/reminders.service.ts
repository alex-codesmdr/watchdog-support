import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { logger } from '../../common/logger.js';
import { emit } from '../../common/outbox.js';

export const REMINDER_DAYS = [30, 60, 90] as const;

/** Today's date in India (coverage dates are calendar dates in IST). */
export const istToday = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);

/**
 * Coverage expiry reminders at 90, 60 and 30 days. Each entitlement gets at most one reminder per
 * window (ledger primary key), and a device that was already renewed (a later entitlement exists)
 * is skipped. One email per organisation and window lists all affected devices.
 */
@Injectable()
export class RemindersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async run(now = new Date()): Promise<{ orgs: number; entitlements: number }> {
    const today = istToday(now);
    return this.db.withSystem(async (tx) => {
      const due = await sql<{ id: string; org_id: string; bucket: number }>`
        SELECT e.id, e.org_id,
               CASE WHEN e.ends_on - ${today}::date <= 30 THEN 30
                    WHEN e.ends_on - ${today}::date <= 60 THEN 60 ELSE 90 END AS bucket
          FROM entitlement e
          JOIN organization o ON o.id = e.org_id AND o.status = 'active'
         WHERE e.ends_on >= ${today}::date
           AND e.ends_on <= ${today}::date + 90
           AND NOT EXISTS (SELECT 1 FROM entitlement n
                            WHERE n.asset_id = e.asset_id AND n.ends_on > e.ends_on)`.execute(tx);
      const groups = new Map<string, string[]>();
      let count = 0;
      for (const r of due.rows) {
        // Claiming the ledger row first makes concurrent workers safe: only one wins the insert.
        const claimed = await tx
          .insertInto('entitlement_reminder')
          .values({ entitlement_id: r.id, days_before: r.bucket })
          .onConflict((oc) => oc.doNothing())
          .returning('entitlement_id')
          .executeTakeFirst();
        if (!claimed) continue;
        const key = `${r.org_id}|${r.bucket}`;
        groups.set(key, [...(groups.get(key) ?? []), r.id]);
        count++;
      }
      for (const [key, ids] of groups) {
        const [orgId, days] = key.split('|') as [string, string];
        await emit(tx, 'coverage.expiring', orgId, {
          orgId,
          days: Number(days),
          entitlementIds: ids,
        });
      }
      if (count)
        logger.info({ orgs: groups.size, entitlements: count }, 'coverage reminders queued');
      return { orgs: groups.size, entitlements: count };
    });
  }

  /** Runs once shortly after start-up and then every few hours; the ledger makes reruns harmless. */
  start(intervalMs = 6 * 3600_000): () => void {
    const tick = () =>
      this.run().catch((err) => logger.error({ err }, 'coverage reminder run failed'));
    const first = setTimeout(tick, 15_000);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }
}
