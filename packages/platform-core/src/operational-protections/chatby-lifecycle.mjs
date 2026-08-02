import { classifyOrderLifecycle } from './lifecycle.mjs';

export const CHATBY_CONTACT_POLICY_VERSION = 'chatby-contact-lifecycle-v1.0.0';

const PROCESS_BLOCKERS = Object.freeze([
  ['open_incident', 'OPEN_INCIDENT'], ['return_pending', 'RETURN_PENDING'], ['active_timer', 'ACTIVE_TIMER'],
  ['discount_pending', 'DISCOUNT_PENDING'], ['refund_change_pending', 'REFUND_CHANGE_PENDING'],
  ['human_review', 'HUMAN_REVIEW'], ['dropea_operation_pending', 'DROPEA_OPERATION_PENDING'],
  ['data_reconciled', 'DATA_NOT_RECONCILED']
]);

export function evaluateChatbyContactLifecycle({ orders = [], processes = {}, identity_status = 'UNKNOWN', contact_id_hash = null } = {}) {
  const classifications = orders.map((order) => ({ canonical_order_id: order.canonical_order_id, ...classifyOrderLifecycle(order) }));
  const blockers = [];
  if (!['EXACT', 'VERIFIED'].includes(String(identity_status).toUpperCase())) blockers.push('IDENTITY_UNCERTAIN');
  if (!contact_id_hash) blockers.push('CONTACT_ID_UNVERIFIED');
  if (!orders.length) blockers.push('NO_LINKED_ORDERS');
  if (classifications.some((item) => item.lifecycle === 'ACTIVE')) blockers.push('ACTIVE_ORDER');
  if (classifications.some((item) => item.lifecycle === 'UNKNOWN')) blockers.push('UNKNOWN_ORDER');
  for (const [field, code] of PROCESS_BLOCKERS) {
    if (field === 'data_reconciled' ? processes[field] !== true : processes[field] === true) blockers.push(code);
  }
  const eligible = blockers.length === 0 && classifications.length > 0 && classifications.every((item) => item.lifecycle === 'TERMINAL');
  return Object.freeze({
    lifecycle_status: eligible ? 'DELETE_ELIGIBLE' : blockers.includes('ACTIVE_ORDER') ? 'BLOCKED_ACTIVE_ORDER'
      : blockers.includes('UNKNOWN_ORDER') ? 'BLOCKED_UNKNOWN_ORDER' : 'BLOCKED_OPEN_PROCESS',
    eligible,
    blockers: Object.freeze(blockers.toSorted()),
    orders: Object.freeze(classifications),
    proposed_action: eligible ? 'QUEUE_OFFICIAL_DELETE' : 'PRESERVE_CONTACT',
    policy_version: CHATBY_CONTACT_POLICY_VERSION,
    actions_executed: 0
  });
}
