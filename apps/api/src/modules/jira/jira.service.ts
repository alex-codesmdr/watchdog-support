import { Inject, Injectable } from '@nestjs/common';
import type { JiraLink } from '@wd/contracts';
import { htmlToText } from '../../common/sanitize.js';
import { logger } from '../../common/logger.js';
import type { Database, Tx } from '../../db/database.js';
import { DB, JIRA } from '../../tokens.js';
import type { JiraAdapter, JiraIssue } from './jira.adapter.js';

const PRIORITY = { P1: 'Highest', P2: 'High', P3: 'Medium', P4: 'Low' } as const;

/** Raises engineering issues from cases and keeps their status in step. */
@Injectable()
export class JiraService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JIRA) private readonly jira: JiraAdapter,
  ) {}

  view(r: {
    issue_key: string;
    issue_url: string;
    status: string;
    category: string;
    synced_at: Date;
  }): JiraLink {
    return {
      key: r.issue_key,
      url: r.issue_url,
      status: r.status,
      category: r.category as JiraLink['category'],
      tracker: this.jira.name,
      syncedAt: r.synced_at.toISOString(),
    };
  }

  /** Builds the engineering issue from the case: what engineering needs, nothing about SLAs or money. */
  async describe(tx: Tx, caseId: string, notes: string) {
    const c = await tx
      .selectFrom('support_case as c')
      .innerJoin('organization as o', 'o.id', 'c.org_id')
      .leftJoin('asset as a', 'a.id', 'c.asset_id')
      .leftJoin('product as p', 'p.id', 'a.product_id')
      .select([
        'c.number',
        'c.subject',
        'c.severity',
        'c.category',
        'c.software_version',
        'c.description_html',
        'c.steps_tried',
        'o.name as org',
        'p.model_name',
        'a.serial_number',
      ])
      .where('c.id', '=', caseId)
      .executeTakeFirstOrThrow();
    const description = [
      `Raised from WatchDog Support case ${c.number} (${c.severity}, ${c.category}) for ${c.org}.`,
      `Product: ${c.model_name ?? 'unknown'}, serial ${c.serial_number ?? 'unknown'}, software ${c.software_version ?? 'unknown'}.`,
      `Customer's description:\n${htmlToText(c.description_html).slice(0, 8000)}`,
      c.steps_tried ? `Steps already tried:\n${c.steps_tried}` : '',
      notes ? `Support engineer's notes:\n${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      summary: `[${c.number}] ${c.subject}`,
      description,
      priority: PRIORITY[c.severity as keyof typeof PRIORITY],
      labels: ['watchdog-support', `case-${c.number.toLowerCase()}`],
    };
  }

  create = (i: Parameters<JiraAdapter['create']>[0]) => this.jira.create(i);
  get = (key: string) => this.jira.get(key);

  /** Records a status change on the case history (staff only). */
  async apply(
    tx: Tx,
    caseId: string,
    before: { status: string; category: string },
    now: JiraIssue,
  ) {
    await tx
      .updateTable('case_jira_link')
      .set({ status: now.status, category: now.category, synced_at: new Date() })
      .where('case_id', '=', caseId)
      .execute();
    if (before.status !== now.status)
      await tx
        .insertInto('case_event')
        .values({
          case_id: caseId,
          type: 'jira_status',
          visibility: 'internal',
          actor_id: null,
          data: JSON.stringify({
            key: now.key,
            from: before.status,
            to: now.status,
            done: now.category === 'done',
          }),
        } as never)
        .execute();
  }

  /** Refreshes open engineering issues. Runs in the worker every few minutes. */
  async sync(limit = 200): Promise<number> {
    const links = await this.db.withSystem((tx) =>
      tx
        .selectFrom('case_jira_link')
        .select(['case_id', 'issue_key', 'status', 'category'])
        .where('category', '!=', 'done')
        .orderBy('synced_at')
        .limit(limit)
        .execute(),
    );
    let changed = 0;
    for (const l of links) {
      try {
        const now = await this.jira.get(l.issue_key);
        if (!now) continue;
        await this.db.withSystem((tx) => this.apply(tx, l.case_id, l, now));
        if (now.status !== l.status) changed++;
      } catch (err) {
        logger.warn({ err, key: l.issue_key }, 'engineering issue sync failed');
      }
    }
    return changed;
  }

  start(intervalMs = 10 * 60_000): () => void {
    const tick = () =>
      this.sync().catch((err) => logger.error({ err }, 'engineering issue sync run failed'));
    const t = setInterval(tick, intervalMs);
    return () => clearInterval(t);
  }
}
