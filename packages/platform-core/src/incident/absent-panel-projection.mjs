export function projectRecipientAbsentShadow(item) {
  const s = item.absent_shadow;
  if (!s || s.policy_version !== 'RECIPIENT_ABSENT_POLICY_V1') return item;
  return { ...item, policy_id: s.policy_version, policy_version: s.policy_version,
    current_step: s.current_step, next_action: s.next_action, reason_summary: s.reason_text,
    customer_intent: s.customer_intent, waiting_customer: s.waiting_customer,
    current_decision_id: s.decision_id, input_snapshot_hash: s.input_snapshot_hash,
    decision_record_status: 'PERSISTED', effective_decision_status: s.simulation_status,
    decision_confidence: s.decision_confidence, effective_human_review: s.simulation_status === 'HUMAN_REVIEW_REQUIRED',
    effective_simulated_action_type: s.simulation_action, effective_blocking_reasons: s.blocking_reasons,
    conditional_proposal: s.conditional_proposal, external_action_status: 'NOT_EXECUTED' };
}
