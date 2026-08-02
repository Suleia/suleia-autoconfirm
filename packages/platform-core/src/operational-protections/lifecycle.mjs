export const ORDER_LIFECYCLE_POLICY_VERSION = 'order-lifecycle-v1.0.0';

export const ACTIVE_ORDER_STATES = Object.freeze(new Set([
  'PENDING', 'CONFIRMATION_WAIT', 'CONFIRMED', 'PROCESSING', 'PREPARING', 'PREPARED',
  'SHIPPING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'ACTIVE_INCIDENT',
  'INCIDENCE', 'PICKUP_PENDING', 'RETRY_PENDING', 'COD_CHANGE_PENDING', 'RETURN_REQUESTED',
  'RETURN_IN_TRANSIT', 'CANCELLATION_PENDING', 'REFUSAL_MANAGEABLE'
]));

export const TERMINAL_ORDER_STATES = Object.freeze(new Set([
  'DELIVERED', 'CANCELLED_FINAL', 'RETURN_TO_ORIGIN_COMPLETED', 'REFUSED_FINAL',
  'RETURN_COMPLETED', 'LOST_CLOSED', 'DAMAGED_CLOSED', 'CLOSED_FINAL'
]));

function normalizedState(order = {}) {
  return String(order.canonical_final_state || order.canonical_state || order.lifecycle_state || order.status || '')
    .trim().toUpperCase();
}
export function classifyOrderLifecycle(order = {}) {
  const state = normalizedState(order);
  if (state === 'HUMAN_REVIEW') {
    return Object.freeze({
      lifecycle: order.operationally_recoverable === false ? 'UNKNOWN' : 'ACTIVE',
      source_state: state,
      policy_version: ORDER_LIFECYCLE_POLICY_VERSION
    });
  }
  if (ACTIVE_ORDER_STATES.has(state)) {
    return Object.freeze({ lifecycle: 'ACTIVE', source_state: state, policy_version: ORDER_LIFECYCLE_POLICY_VERSION });
  }
  if (TERMINAL_ORDER_STATES.has(state) && order.final_state_verified === true) {
    return Object.freeze({ lifecycle: 'TERMINAL', source_state: state, policy_version: ORDER_LIFECYCLE_POLICY_VERSION });
  }
  return Object.freeze({ lifecycle: 'UNKNOWN', source_state: state || 'MISSING', policy_version: ORDER_LIFECYCLE_POLICY_VERSION });
}
