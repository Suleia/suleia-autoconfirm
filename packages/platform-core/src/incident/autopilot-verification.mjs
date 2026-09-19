import crypto from 'node:crypto';

function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function verifyIncidentAction({ action, expected, observed, checkedAt = new Date(), attempt = 1 } = {}) {
  if (!action?.actionId) throw new Error('Verification requires a persisted action');
  const complete = observed !== null && observed !== undefined;
  const matches = complete && Object.entries(expected || {}).every(([key, value]) => observed?.[key] === value);
  const status = matches ? 'VERIFIED' : complete && attempt >= 3 ? 'FAILED' : 'PENDING';
  return Object.freeze({
    verificationId: `verification-${hash([action.actionId, expected, observed, attempt]).slice(0, 24)}`,
    actionId: action.actionId, incidentId: action.incidentId, orderId: action.orderId,
    status, checkedAt: new Date(checkedAt).toISOString(), attempt,
    expected: expected || {}, observed: observed || null,
    nextState: status === 'VERIFIED'
      ? action.type === 'REQUEST_RETURN' ? 'RETURNED' : ['REQUEST_REDELIVERY', 'REQUEST_AGENCY_PICKUP'].includes(action.type) ? 'WAITING_REDELIVERY' : 'RECOVERED'
      : status === 'FAILED' ? 'HUMAN_REVIEW' : 'ACTION_VERIFYING',
    reason: matches ? 'PROVIDER_STATE_MATCHED' : complete ? 'PROVIDER_STATE_NOT_YET_MATCHED' : 'PROVIDER_STATE_UNAVAILABLE',
    actionsExecuted: 0, productionWrites: 0
  });
}
