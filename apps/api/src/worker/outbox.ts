import { sql } from 'kysely';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Database } from '../db/database.js';
import { logger } from '../common/logger.js';

export interface EventMeta {
  eventId: string;
  orgId: string | null;
}
export type Handler = (
  topic: string,
  payload: Record<string, unknown>,
  meta: EventMeta,
) => Promise<void>;

/** Topics that customers can receive as webhooks: fanned out to the `webhooks` queue as well. */
const WEBHOOK_FANOUT = new Set([
  'case.created',
  'case.status_changed',
  'case.message.public_created',
  'sla.breached',
  'rma.status_changed',
  'advisory.published',
  'coverage.expiring',
]);

const QUEUE_FOR: Record<string, string> = {
  'attachment.scan': 'file-scan',
  'release.file.scan': 'file-scan',
};
const queueFor = (topic: string) => QUEUE_FOR[topic] ?? 'notifications';
const MAX_ATTEMPTS = 8;

/**
 * Outbox relay (ADR-006). Claims unpublished rows with SKIP LOCKED so several workers can run.
 * Mode `inline` executes handlers directly (tests, single-process dev);
 * mode `bullmq` publishes to Redis queues consumed by `startConsumers`.
 */
export class OutboxRelay {
  private stopped = false;
  constructor(
    private readonly db: Database,
    private readonly mode:
      { kind: 'inline'; handler: Handler } | { kind: 'bullmq'; connection: ConnectionOptions },
  ) {}

  private queues = new Map<string, Queue>();
  private queue(name: string) {
    let q = this.queues.get(name);
    if (!q && this.mode.kind === 'bullmq') {
      q = new Queue(name, {
        connection: this.mode.connection,
        defaultJobOptions: {
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });
      this.queues.set(name, q);
    }
    return q!;
  }

  /** Processes one batch; returns the number of events handled. */
  async runOnce(batch = 50): Promise<number> {
    return this.db.withSystem(async (tx) => {
      const rows = await tx
        .selectFrom('outbox_event')
        .select(['id', 'topic', 'payload', 'attempts', 'org_id'])
        .where('published_at', 'is', null)
        .where('available_at', '<=', new Date())
        .orderBy('created_at')
        .limit(batch)
        .forUpdate()
        .skipLocked()
        .execute();
      for (const r of rows) {
        try {
          const meta: EventMeta = { eventId: r.id, orgId: r.org_id };
          if (this.mode.kind === 'inline')
            await this.mode.handler(r.topic, r.payload as Record<string, unknown>, meta);
          else {
            await this.queue(queueFor(r.topic)).add(
              r.topic,
              { ...(r.payload as object), __meta: meta },
              { jobId: r.id },
            );
            if (WEBHOOK_FANOUT.has(r.topic))
              await this.queue('webhooks').add(
                r.topic,
                { ...(r.payload as object), __meta: meta },
                { jobId: `${r.id}-wh` },
              );
          }
          await tx
            .updateTable('outbox_event')
            .set({ published_at: new Date() })
            .where('id', '=', r.id)
            .execute();
        } catch (err) {
          const attempts = r.attempts + 1;
          logger.error({ err, topic: r.topic, attempts }, 'outbox dispatch failed');
          await tx
            .updateTable('outbox_event')
            .set({
              attempts,
              last_error: (err as Error).message.slice(0, 1000),
              available_at: sql`now() + make_interval(secs => ${Math.min(3600, 2 ** attempts * 5)})`,
              // Park permanently failing events (visible to ops) instead of retrying forever.
              published_at: attempts >= MAX_ATTEMPTS ? sql`'infinity'::timestamptz` : null,
            } as never)
            .where('id', '=', r.id)
            .execute();
        }
      }
      return rows.length;
    });
  }

  start(intervalMs = 1000) {
    const loop = async () => {
      while (!this.stopped) {
        const n = await this.runOnce().catch((err) => {
          logger.error({ err }, 'outbox relay error');
          return 0;
        });
        if (n === 0) await new Promise((r) => setTimeout(r, intervalMs));
      }
    };
    void loop();
  }

  async stop() {
    this.stopped = true;
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

export function startConsumers(
  connection: ConnectionOptions,
  handlers: Record<string, Handler>,
): Worker[] {
  return Object.entries(handlers).map(([name, handler]) => {
    const w = new Worker(
      name,
      (job) => {
        const { __meta, ...payload } = job.data as Record<string, unknown> & { __meta?: EventMeta };
        return handler(job.name, payload, __meta ?? { eventId: String(job.id), orgId: null });
      },
      {
        connection,
        concurrency: name === 'file-scan' ? 2 : 10,
      },
    );
    w.on('failed', (job, err) => logger.error({ err, queue: name, job: job?.id }, 'job failed'));
    return w;
  });
}
