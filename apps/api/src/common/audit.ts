import type { Tx } from '../db/database.js';
import type { RequestContext } from './principal.js';

/** Appends to the hash-chained audit log in the same transaction as the change it records. */
export async function audit(
  tx: Tx,
  ctx: Pick<RequestContext, 'requestId' | 'ip'> & { actorId: string | null },
  entry: { action: string; orgId: string | null; targetType?: string; targetId?: string; diff?: Record<string, unknown> },
): Promise<void> {
  await tx
    .insertInto('audit_log')
    .values({
      org_id: entry.orgId,
      actor_id: ctx.actorId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      diff: JSON.stringify(entry.diff ?? {}),
      ip: ctx.ip,
      request_id: ctx.requestId,
    } as never)
    .execute();
}
