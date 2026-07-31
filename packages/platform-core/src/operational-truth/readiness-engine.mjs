import { C0_SCHEMA_VERSION, READINESS_RESULTS, zeroActionEnvelope } from './contracts.mjs';

export const READINESS_DIMENSIONS = Object.freeze([
  'infrastructure', 'connector', 'data', 'identity', 'business_rule_parity', 'timer_parity',
  'decision_parity', 'security', 'backup', 'restore', 'rollback', 'observability', 'operational', 'human_review'
]);

export class MigrationReadinessEngine {
  evaluate(input) {
    const dimensions = Object.fromEntries(READINESS_DIMENSIONS.map((name) => [name, input.dimensions?.[name] || 'NOT_ASSESSED']));
    const blockers = [
      ...(input.critical_issues > 0 ? ['CRITICAL_QUALITY_ISSUE'] : []),
      ...(input.backup_restorable !== true ? ['BACKUP_NOT_RESTORABLE'] : []),
      ...(input.rollback_validated !== true ? ['ROLLBACK_NOT_VALIDATED'] : []),
      ...(!['EXACT', 'VERIFIED'].includes(input.identity_status) ? ['IDENTITY_NOT_RELIABLE'] : []),
      ...(input.production_write_possible ? ['PRODUCTION_WRITE_POSSIBLE'] : []),
      ...(input.action_executor_enabled ? ['ACTION_EXECUTOR_ENABLED'] : []),
      ...(input.critical_parity_demonstrated !== true ? ['CRITICAL_PARITY_NOT_DEMONSTRATED'] : []),
      ...(input.replay_reproducible !== true ? ['REPLAY_NOT_REPRODUCIBLE'] : []),
      ...(input.safe_read_only !== true ? ['SAFE_READ_ONLY_NOT_PROVEN'] : [])
    ];
    let readiness = 'NOT_READY';
    if (!blockers.length && input.comparison_available && input.data_quality_approved && input.actions_executed === 0) readiness = 'SHADOW_READY';
    else if (!blockers.length) readiness = 'CONDITIONALLY_READY';
    if (!READINESS_RESULTS.includes(readiness)) throw new Error('Invalid readiness result');
    return Object.freeze({
      readiness, dimensions, blocking_reasons: [...new Set(blockers)].toSorted(),
      canary_ready: false, cutover_ready: false,
      canary_criteria_only: ['SHADOW_EVIDENCE_APPROVED', 'CONTROLLED_SAMPLE', 'OWNER_AUTHORIZATION'],
      cutover_criteria_only: ['CANARY_APPROVED', 'ROLLBACK_DRILL', 'OWNER_AUTHORIZATION'],
      schema_version: C0_SCHEMA_VERSION, ...zeroActionEnvelope()
    });
  }
}

export function evaluateShadowEligibility(input) {
  const reasons = [
    ...(!['EXACT', 'VERIFIED'].includes(input.identity_status) ? ['IDENTITY_NOT_EXACT_OR_VERIFIED'] : []),
    ...(input.critical_sources_available !== true ? ['CRITICAL_SOURCES_UNAVAILABLE'] : []),
    ...(input.data_quality_approved !== true ? ['DATA_QUALITY_NOT_APPROVED'] : []),
    ...(input.timeline_complete !== true ? ['TIMELINE_INCOMPLETE'] : []),
    ...(input.policy_versioned !== true ? ['POLICY_NOT_VERSIONED'] : []),
    ...(input.timer_reproducible !== true ? ['TIMER_NOT_REPRODUCIBLE'] : []),
    ...(input.replay_deterministic !== true ? ['REPLAY_NOT_DETERMINISTIC'] : []),
    ...(input.decision_stable !== true ? ['DECISION_NOT_STABLE'] : []),
    ...(input.actions_blocked !== true ? ['ACTIONS_NOT_BLOCKED'] : []),
    ...(input.comparison_available !== true ? ['COMPARISON_UNAVAILABLE'] : [])
  ];
  return Object.freeze({ shadow_eligible: reasons.length === 0, blocking_reasons: reasons.toSorted(), ...zeroActionEnvelope() });
}
