const CHECKS = Object.freeze([
  ['decision_engine_available', 'DECISION_ENGINE_UNAVAILABLE'],
  ['policy_engine_available', 'POLICY_ENGINE_UNAVAILABLE'],
  ['api_available', 'API_UNAVAILABLE'],
  ['database_available', 'DATABASE_UNAVAILABLE'],
  ['config_valid', 'CONFIG_INVALID'],
  ['state_fresh', 'STATE_STALE'],
  ['credentials_consistent', 'CREDENTIALS_INCONSISTENT'],
  ['idempotency_available', 'IDEMPOTENCY_UNAVAILABLE'],
  ['lock_acquired', 'LOCK_NOT_ACQUIRED']
]);

export function evaluateScheduledRun(input = {}) {
  const blockers = CHECKS.filter(([name]) => input[name] !== true).map(([, code]) => code);
  return Object.freeze({
    disposition: blockers.length ? 'SKIP_RETRY_SAFE' : 'SIMULATION_ONLY',
    retry_safe: true,
    blockers: Object.freeze(blockers),
    actions_executed: 0,
    production_writes: 0
  });
}
