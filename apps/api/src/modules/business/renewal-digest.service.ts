import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { logger } from '../../common/logger.js';
import { emit } from '../../common/outbox.js';
import { renewalPipeline } from './contracts.controller.js';

/** Monday (YYYY-MM-DD) of the India-time week that `now` falls in. */
export function istWeek(now: Date): string {
  const d = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)}T00:00:00Z`,
  );
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly renewal digest: each account owner gets their own open renewals for the next 90 days;
 * support managers also get the ones nobody owns yet. One email per person per week.
 */
@Injectable()
export class RenewalDigestService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async run(now = new Date()): Promise<{ queued: number }> {
    const week = istWeek(now);
    return this.db.withSystem(async (tx) => {
      const p = await renewalPipeline(tx, 90);
      const open = p.items.filter((i) => i.stage !== 'won' && i.stage !== 'lost');
      if (!open.length) return { queued: 0 };
      const owners = new Set(open.map((i) => i.ownerId).filter((x): x is string => !!x));
      const managers = open.some((i) => !i.ownerId)
        ? (
            await sql<{ id: string }>`
              SELECT u.id FROM app_user u JOIN user_role ur ON ur.user_id = u.id
               WHERE ur.role_key = 'support_manager' AND u.status = 'active'`.execute(tx)
          ).rows.map((r) => r.id)
        : [];
      let queued = 0;
      for (const userId of new Set([...owners, ...managers])) {
        const claimed = await tx
          .insertInto('renewal_digest')
          .values({ user_id: userId, week })
          .onConflict((oc) => oc.doNothing())
          .returning('user_id')
          .executeTakeFirst();
        if (!claimed) continue;
        await emit(tx, 'renewal.digest', null, {
          userId,
          week,
          unowned: managers.includes(userId),
        });
        queued++;
      }
      if (queued) logger.info({ queued, week }, 'renewal digests queued');
      return { queued };
    });
  }

  start(intervalMs = 6 * 3600_000): () => void {
    const tick = () =>
      this.run().catch((err) => logger.error({ err }, 'renewal digest run failed'));
    const first = setTimeout(tick, 90_000);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }
}
