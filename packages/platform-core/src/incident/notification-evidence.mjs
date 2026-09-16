// Notification aliases are observations of existing templates, not send rules.
export const INCIDENT_NOTIFICATION_TEMPLATES = Object.freeze({
  RECIPIENT_ABSENT: ['dropea_ausente_v1','dropea_incidencia_ausente_v1','dropea_incidencia_ausente_v2'],
  PICKUP_AT_AGENCY: ['dropea_ausente_v1','dropea_incidencia_ausente_v1','dropea_incidencia_ausente_v2'],
  REFUSED_BY_RECIPIENT: ['dropea_incidencia_mercancia_v1'],
  ADDRESS_INCORRECT: ['dropea_incidencia_direccion_v1'],
  PENDING_DATA: ['dropea_incidencia_direccion_v1']
});
export function incidentNotificationBoundary(events, { issueId, orderId, issueType, createdAt, now = new Date() }) {
  const allowed = INCIDENT_NOTIFICATION_TEMPLATES[issueType] || [];
  return events.filter(e => e.canonical_issue_id === issueId && e.canonical_order_id === orderId
    && e.direction === 'OUTBOUND' && e.message_type === 'TEMPLATE'
    && allowed.includes(e.context_template_slug)
    && Number.isFinite(new Date(e.created_at).getTime())
    && new Date(e.created_at) >= new Date(createdAt) && new Date(e.created_at) <= new Date(now))
    .sort((a,b) => new Date(a.created_at)-new Date(b.created_at))[0]?.created_at || null;
}
export function projectNotificationScopedIncident(item) {
  if (!item.scoped_response_status) return item;
  const verified = item.scoped_response_status === 'VALID_RESPONSE';
  const invalid = item.scoped_response_status === 'NOT_VERIFIABLE';
  const intent = verified ? item.scoped_customer_intent || 'UNKNOWN' : invalid ? 'UNKNOWN' : 'NO_RESPONSE';
  const sameTime = (a,b) => Boolean(a && b && new Date(a).getTime()===new Date(b).getTime());
  const sameStoredResponse = verified && sameTime(item.stored_interpretation_message_at,item.scoped_customer_activity_at)
    && item.stored_interpretation_intent===intent;
  const shadow = item.absent_shadow;
  const shadowCurrent = shadow && sameStoredResponse && shadow.input_snapshot?.response_hash
    && shadow.input_snapshot.response_hash===item.stored_interpretation_response_hash
    && item.decided_at && new Date(item.decided_at)>=new Date(item.scoped_customer_activity_at);
  // Never let shadow projection overwrite the latest scoped customer facts.
  // Unbound historical decisions are for audit only, not current proposals.
  const staleDecision = invalid || Boolean(shadow && !shadowCurrent)
    || item.scoped_response_status === 'NO_VALID_RESPONSE' && Boolean(item.stored_interpretation_message_at)
    || verified && (!sameStoredResponse || !item.decided_at || new Date(item.decided_at)<new Date(item.scoped_customer_activity_at));
  return { ...item, operational_response_status: item.scoped_response_status,
    chatby_sync_current: !invalid, customer_replied_after_issue: verified, customer_intent: intent,
    ...(staleDecision ? { effective_decision_status: 'REVIEW', effective_human_review: true,
      decision_record_status: 'HISTORICAL', effective_simulated_action_type: null,
      effective_qa_status: 'REVIEW', currently_blocked: true,
      conditional_proposal: 'HUMAN_REVIEW_REQUIRED', waiting_customer: false, decision_confidence: null,
      effective_blocking_reasons: [...new Set([...(item.effective_blocking_reasons || []),invalid ? item.scoped_response_reason : 'DECISION_NOT_BOUND_TO_SCOPED_RESPONSE'])],
      absent_shadow: null } : {}) };
}
