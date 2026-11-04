/**
 * RMA (return material authorisation) lifecycle, shared by the API (enforcement) and the web
 * (which buttons to show).
 *
 * standard:  requested → approved → return_in_transit → received → replacement_shipped → closed
 * advance:   requested → approved → replacement_shipped → return_in_transit → received → closed
 * Any open RMA can be rejected (from requested) or cancelled (before anything has shipped).
 */
export const RMA_STATUSES = [
  'requested',
  'approved',
  'return_in_transit',
  'received',
  'replacement_shipped',
  'closed',
  'rejected',
  'cancelled',
] as const;
export type RmaStatus = (typeof RMA_STATUSES)[number];
export const RMA_TYPES = ['standard', 'advance'] as const;
export type RmaType = (typeof RMA_TYPES)[number];

export const RMA_STATUS_LABELS: Record<RmaStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  return_in_transit: 'Faulty unit on its way',
  received: 'Faulty unit received',
  replacement_shipped: 'Replacement shipped',
  closed: 'Closed',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};
export const RMA_TYPE_LABELS: Record<RmaType, string> = {
  standard: 'Return, then replace',
  advance: 'Advance replacement',
};
export const RMA_OPEN: readonly RmaStatus[] = [
  'requested',
  'approved',
  'return_in_transit',
  'received',
  'replacement_shipped',
];

export interface RmaState {
  status: RmaStatus;
  type: RmaType;
  shipped: boolean; // replacement already sent
  received: boolean; // faulty unit already back
}

/** Next statuses the actor may move the RMA to. */
export function rmaNext(r: RmaState, actor: 'coordinator' | 'customer'): RmaStatus[] {
  const out: RmaStatus[] = [];
  const add = (s: RmaStatus, who: Array<'coordinator' | 'customer'>) => {
    if (who.includes(actor)) out.push(s);
  };
  switch (r.status) {
    case 'requested':
      add('approved', ['coordinator']);
      add('rejected', ['coordinator']);
      add('cancelled', ['coordinator', 'customer']);
      break;
    case 'approved':
      if (r.type === 'advance') add('replacement_shipped', ['coordinator']);
      else add('return_in_transit', ['coordinator', 'customer']);
      add('cancelled', ['coordinator', 'customer']);
      break;
    case 'return_in_transit':
      add('received', ['coordinator']);
      break;
    case 'received':
      if (r.shipped) add('closed', ['coordinator']);
      else add('replacement_shipped', ['coordinator']);
      break;
    case 'replacement_shipped':
      if (r.received) add('closed', ['coordinator']);
      else add('return_in_transit', ['coordinator', 'customer']);
      break;
    default:
      break;
  }
  return out;
}
