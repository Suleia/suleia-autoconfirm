const REQUIRED_CHECKS = Object.freeze([
  'identity_valid',
  'state_valid',
  'freshness_valid',
  'evidence_sufficient',
  'policy_current',
  'timer_valid',
  'no_contradictions',
  'no_duplicates',
  'idempotency_present',
  'logistics_compatible',
  'action_allowed',
  'masking_valid',
  'authorization_present',
  'schema_valid'
]);

export function evaluateQaGate(input) {
  const checks = Object.fromEntries(REQUIRED_CHECKS.map((field) => [field, input[field] === true]));
  const failed = REQUIRED_CHECKS.filter((field) => !checks[field]);
  let result;
  if (input.risk_level === 'CRITICAL' || ['schema_valid', 'masking_valid', 'action_allowed'].some((field) => failed.includes(field))) {
    result = 'BLOCKED';
  } else if (input.risk_level === 'HIGH' || failed.length) {
    result = ['no_duplicates', 'idempotency_present', 'timer_valid', 'logistics_compatible'].some((field) => failed.includes(field))
      ? 'BLOCKED'
      : 'HUMAN_REVIEW';
  } else if (input.risk_level === 'MEDIUM' || input.warnings?.length) {
    result = 'PASS_WITH_WARNING';
  } else {
    result = 'PASS';
  }
  return Object.freeze({
    qa_result: result,
    checks: Object.freeze(checks),
    failed_checks: Object.freeze(failed),
    warnings: Object.freeze([...(input.warnings ?? [])]),
    execution_disposition: 'SIMULATION_ONLY'
  });
}

export { REQUIRED_CHECKS as QA_REQUIRED_CHECKS };
