import type { Tx } from '../db/database.js';

export type OutboxTopic =
  | 'registration.received'
  | 'registration.approved'
  | 'registration.rejected'
  | 'case.created'
  | 'case.message.public_created'
  | 'case.status_changed'
  | 'case.customer_escalated'
  | 'case.escalated'
  | 'attachment.scan'
  | 'sla.warning'
  | 'sla.breached'
  | 'renewal.requested'
  | 'coverage.expiring';

/** Transactional outbox (ADR-006): the event commits or rolls back with the business change. */
export async function emit(
  tx: Tx,
  topic: OutboxTopic,
  orgId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx
    .insertInto('outbox_event')
    .values({ topic, org_id: orgId, payload: JSON.stringify(payload) })
    .execute();
}
