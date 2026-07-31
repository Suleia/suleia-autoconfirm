export const PHASE_B_EXECUTION_FLAGS = Object.freeze({
  ACTION_EXECUTOR_ENABLED: false,
  PRODUCTION_WRITES_ENABLED: false,
  CUSTOMER_MESSAGES_ENABLED: false,
  ORDER_CONFIRMATION_ENABLED: false,
  ORDER_CANCELLATION_ENABLED: false,
  RETURN_TO_ORIGIN_ENABLED: false,
  DISCOUNTS_ENABLED: false
});

export function evaluateAuthorizationContract({ policy, risk, qa, compliance, correlation_id }) {
  const blockers = [];
  if (!policy) blockers.push('POLICY_NOT_SELECTED');
  if (risk?.risk_level === 'CRITICAL') blockers.push('CRITICAL_RISK');
  if (risk?.risk_level === 'HIGH') blockers.push('HUMAN_REVIEW_REQUIRED');
  if (qa?.qa_result === 'BLOCKED') blockers.push('QA_BLOCKED');
  if (qa?.qa_result === 'HUMAN_REVIEW') blockers.push('QA_HUMAN_REVIEW');
  if (compliance?.compliance_result !== 'PASS') blockers.push('COMPLIANCE_BLOCKED');
  return Object.freeze({
    authorization_id: `simulation:${correlation_id}`,
    policy_id: policy?.policy_id ?? null,
    policy_version: policy?.version ?? null,
    proposed_action: policy?.proposed_action ?? 'NO_ACTION',
    authorization_result: blockers.length ? 'BLOCKED_OR_REVIEW' : 'SIMULATION_ONLY',
    execution_disposition: 'SIMULATION_ONLY',
    blockers: Object.freeze(blockers),
    flags: PHASE_B_EXECUTION_FLAGS,
    actions_executed: 0,
    production_writes: 0,
    messages_sent: 0
  });
}
