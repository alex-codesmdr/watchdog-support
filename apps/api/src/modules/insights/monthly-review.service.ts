import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { logger } from '../../common/logger.js';
import { emit } from '../../common/outbox.js';
import { SettingsService } from '../settings/settings.service.js';
import { monthStart } from './stats.js';

/**
 * Monthly service review: early each month, every active customer organisation with a customer
 * administrator gets a summary of the month before. The ledger row is claimed first, so reruns and
 * several workers never send twice. Organisations with nothing to report are skipped when sending.
 */
@Injectable()
export class MonthlyReviewService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async run(now = new Date()): Promise<{ queued: number }> {
    if (!(await this.settings.get()).monthlyReviewEmail) return { queued: 0 };
    const month = monthStart(now, -1);
    return this.db.withSystem(async (tx) => {
      const orgs = await sql<{ id: string }>`
        SELECT o.id FROM organization o
         WHERE o.status = 'active' AND o.org_type = 'customer'
           AND EXISTS (SELECT 1 FROM user_role ur JOIN app_user u ON u.id = ur.user_id
                        WHERE u.org_id = o.id AND u.status = 'active' AND ur.role_key = 'customer_admin')
           AND NOT EXISTS (SELECT 1 FROM monthly_review r WHERE r.org_id = o.id AND r.month = ${month}::date)`.execute(
        tx,
      );
      let queued = 0;
      for (const o of orgs.rows) {
        const claimed = await tx
          .insertInto('monthly_review')
          .values({ org_id: o.id, month })
          .onConflict((oc) => oc.doNothing())
          .returning('org_id')
          .executeTakeFirst();
        if (!claimed) continue;
        await emit(tx, 'review.monthly', o.id, { orgId: o.id, month });
        queued++;
      }
      if (queued) logger.info({ queued, month }, 'monthly reviews queued');
      return { queued };
    });
  }

  start(intervalMs = 6 * 3600_000): () => void {
    const tick = () =>
      this.run().catch((err) => logger.error({ err }, 'monthly review run failed'));
    const first = setTimeout(tick, 60_000);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }
}
