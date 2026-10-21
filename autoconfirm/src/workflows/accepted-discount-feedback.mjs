const MAX_AGE_MS = 45 * 60_000;

// Observation only: the previous support receipt never authorizes a new write.
export function applyAcceptedDiscountFeedback(incidents, feedback, now = Date.now()) {
  if (!Array.isArray(feedback?.cases)) return incidents;
  const cases = new Map(feedback.cases.map(item => [`${item.orderId}:${item.currentIssueId}`, item]));
  for (const incident of incidents) {
    const item = cases.get(`${incident.orderId}:${incident.incidenceId}`);
    const checkedAt = Date.parse(item?.checkedAt || '');
    if (!item || !Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > MAX_AGE_MS) continue;
    incident.acceptedDiscountSupport = Object.fromEntries([
      'orderId','currentIssueId','supportIssueId','status','reason','needsHumanReview','supportVerified',
      'orderAmountStatus','orderDiscountApplied','currentAmountCents','expectedAmountCents','currency',
      'carrierCodApplied','discountApplied','customerResponseStatus','customerResponseAt','checkedAt'
    ].filter(key => Object.hasOwn(item,key)).map(key => [key,item[key]]));
    if (!item.needsHumanReview) continue;
    const previous = incident.incidentResolution || {};
    incident.incidentResolution = {
      ...previous,
      incident_id: String(incident.incidenceId), order_id: String(incident.orderId),
      observed_at: item.checkedAt, current_owner: 'HUMAN',
      customer_replied: previous.customer_replied === true || item.customerResponseStatus === 'DISCOUNT_ACCEPTED',
      customer_replied_but_unresolved: previous.customer_replied === true || item.customerResponseStatus === 'DISCOUNT_ACCEPTED',
      customer_event_at: item.customerResponseAt || previous.customer_event_at || null,
      human_review_reason: String(item.supportIssueId) !== String(item.currentIssueId)
        ? 'ACCEPTED_DISCOUNT_INCIDENT_REOPENED' : 'ACCEPTED_DISCOUNT_SUPPORT_RECONCILIATION_REQUIRED',
      next_best_action: 'REVIEW_ACCEPTED_DISCOUNT_SUPPORT', explicit_wait_until: null,
      execution_status: 'NOT_REQUESTED', verification_status: 'NOT_VERIFIED', action_prepared: false
    };
  }
  return incidents;
}
