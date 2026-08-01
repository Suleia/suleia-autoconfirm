import crypto from 'node:crypto';

export const INCIDENT_RESPONSE_HOURS = 48;
export const UNKNOWN_REVIEW_HOURS = 72;
export const CONFIRMATION_WAIT_HOURS = 1;

function iso(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be an ISO date`);
  return date.toISOString();
}

export function createIncidentTimer({
  timerType = 'CUSTOMER_RESPONSE',
  orderId,
  issueId,
  issueVersion,
  relevantEventId,
  policyVersion,
  startedAt,
  durationHours = INCIDENT_RESPONSE_HOURS,
  previousTimer = null
}) {
  for (const [field, value] of Object.entries({ orderId, issueId, issueVersion, relevantEventId, policyVersion, startedAt })) {
    if (value === undefined || value === null || value === '') throw new Error(`${field} is required`);
  }
  const start = iso(startedAt, 'startedAt');
  const identity = [timerType, orderId, issueId, issueVersion, relevantEventId, policyVersion].join(':');
  const timerId = `timer-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
  const dueAt = new Date(new Date(start).getTime() + Number(durationHours) * 3_600_000).toISOString();
  return Object.freeze({
    timer_id: timerId,
    timer_type: timerType,
    order_id: String(orderId),
    issue_id: String(issueId),
    issue_version: String(issueVersion),
    relevant_event_id: String(relevantEventId),
    policy_version: String(policyVersion),
    started_at: start,
    due_at: dueAt,
    status: 'ACTIVE',
    supersedes: previousTimer && previousTimer.timer_id !== timerId ? previousTimer.timer_id : null,
    superseded_by: null,
    actions_executed: 0,
    run_mode: 'SIMULATION'
  });
}

export function closeTimerForInactiveIssue(timer, observedAt) {
  if (!timer) return null;
  return Object.freeze({ ...timer, status: 'COMPLETED', completed_at: iso(observedAt, 'observedAt'), actions_executed: 0 });
}
