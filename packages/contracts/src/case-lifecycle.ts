/**
 * Case status lifecycle. Shared by API (enforcement) and web (which buttons to show).
 */
export const CASE_STATUSES = [
  'new',
  'triage',
  'in_progress',
  'awaiting_customer',
  'awaiting_vendor',
  'workaround_provided',
  'resolved',
  'closed',
  'reopened',
] as const;
export type CaseStatusKey = (typeof CASE_STATUSES)[number];

export const STATUS_LABELS: Record<CaseStatusKey, string> = {
  new: 'New',
  triage: 'Triage',
  in_progress: 'In Progress',
  awaiting_customer: 'Awaiting Customer',
  awaiting_vendor: 'Awaiting Engineering',
  workaround_provided: 'Workaround Provided',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
};

/** Transitions a support engineer may perform. */
export const STAFF_TRANSITIONS: Record<CaseStatusKey, readonly CaseStatusKey[]> = {
  new: ['triage', 'in_progress', 'awaiting_customer', 'resolved'],
  triage: ['in_progress', 'awaiting_customer', 'awaiting_vendor', 'resolved'],
  in_progress: ['awaiting_customer', 'awaiting_vendor', 'workaround_provided', 'resolved'],
  awaiting_customer: ['in_progress', 'resolved'],
  awaiting_vendor: ['in_progress', 'workaround_provided', 'resolved'],
  workaround_provided: ['in_progress', 'awaiting_customer', 'resolved'],
  resolved: ['reopened', 'closed'],
  closed: [],
  reopened: ['in_progress', 'awaiting_customer', 'awaiting_vendor', 'resolved'],
};

/** Transitions a customer (requester / customer admin / delegated partner) may perform. */
export const CUSTOMER_TRANSITIONS: Record<CaseStatusKey, readonly CaseStatusKey[]> = {
  new: ['closed'],
  triage: ['closed'],
  in_progress: ['closed'],
  awaiting_customer: ['closed'],
  awaiting_vendor: [],
  workaround_provided: ['closed'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['closed'],
};

/** Closed cases may be reopened by the customer for this many days. */
export const REOPEN_WINDOW_DAYS = 14;

export const OPEN_STATUSES: readonly CaseStatusKey[] = CASE_STATUSES.filter(
  (s) => s !== 'resolved' && s !== 'closed',
);

export function canTransition(
  from: CaseStatusKey,
  to: CaseStatusKey,
  actor: 'staff' | 'customer',
): boolean {
  const table = actor === 'staff' ? STAFF_TRANSITIONS : CUSTOMER_TRANSITIONS;
  return table[from].includes(to);
}
