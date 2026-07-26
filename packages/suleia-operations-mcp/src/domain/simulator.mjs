function latest(items, field) {
  return [...items].sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || '')))[0] || null;
}

function hasEvent(timeline, type) {
  return timeline.some((event) => event.event_type === type);
}

export function simulateDecision({ order, timeline, timers, asOf = new Date() }) {
  const cancellation = hasEvent(timeline, 'customer_cancelled');
  const addressChange = hasEvent(timeline, 'address_change_requested');
  const confirmed = hasEvent(timeline, 'customer_confirmed');
  const timer = latest(timers.filter((item) => item.timer_type === 'confirmation_wait'), 'due_at');
  const timerDue = timer ? new Date(timer.due_at).getTime() <= asOf.getTime() : false;

  let decision = 'REVIEW';
  let confidence = 0.6;
  let reasonCodes = ['INSUFFICIENT_EVIDENCE'];

  if (cancellation) {
    decision = 'DO_NOT_CONFIRM';
    confidence = 0.99;
    reasonCodes = ['CUSTOMER_CANCELLED'];
  } else if (addressChange) {
    decision = 'REVIEW_ADDRESS_CHANGE';
    confidence = 0.95;
    reasonCodes = ['ADDRESS_CHANGE_REQUESTED'];
  } else if (confirmed && timerDue) {
    decision = 'WOULD_CONFIRM';
    confidence = 0.97;
    reasonCodes = ['CUSTOMER_CONFIRMED', 'WAITING_PERIOD_COMPLETE', 'NO_LATER_CANCELLATION'];
  } else if (confirmed) {
    decision = 'WAIT_CONFIRMATION_TIMER';
    confidence = 0.97;
    reasonCodes = ['CUSTOMER_CONFIRMED', 'WAITING_PERIOD_ACTIVE'];
  }

  return {
    order_id: order.order_id,
    decision,
    confidence,
    reason_codes: reasonCodes,
    evaluated_at: asOf.toISOString(),
    timer_due_at: timer?.due_at || null,
    actions_executed: 0,
    simulation_only: true
  };
}

export function compareDecisions(simulation, currentDecisions) {
  const current = latest(currentDecisions, 'decided_at');
  const normalizedCurrent = current?.decision === 'CONFIRM_AFTER_DELAY'
    ? 'WAIT_CONFIRMATION_TIMER'
    : current?.decision || null;
  return {
    order_id: simulation.order_id,
    simulation_decision: simulation.decision,
    current_system_decision: current?.decision || null,
    equivalent_decision: normalizedCurrent,
    matches_current_system: normalizedCurrent === simulation.decision,
    difference_codes: normalizedCurrent === simulation.decision
      ? []
      : ['DECISION_MISMATCH'],
    actions_executed: 0,
    simulation_only: true
  };
}
