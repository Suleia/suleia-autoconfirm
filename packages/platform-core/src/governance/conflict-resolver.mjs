import { compareVersions } from './contracts.mjs';

const SAFETY_PROHIBITIONS = Object.freeze([
  'production_write_requested',
  'unmasked_pii',
  'invalid_schema',
  'action_executor_requested'
]);

function specificity(policy) {
  return Number.isFinite(policy.specificity) ? policy.specificity : policy.scope.length;
}

function sourceFreshness(policy) {
  const value = policy.source_freshness_at ?? policy.effective_from;
  return Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
}

function comparePolicyRank(left, right) {
  if (specificity(left) !== specificity(right)) return specificity(right) - specificity(left);
  if (left.priority !== right.priority) return right.priority - left.priority;
  const version = compareVersions(right.version, left.version);
  if (version !== 0) return version;
  return sourceFreshness(right) - sourceFreshness(left);
}

function sameDeterministicRank(left, right) {
  return specificity(left) === specificity(right)
    && left.priority === right.priority
    && compareVersions(left.version, right.version) === 0
    && sourceFreshness(left) === sourceFreshness(right);
}

export function resolvePolicyConflict(policies, context = {}) {
  const safety = SAFETY_PROHIBITIONS.filter((condition) => context[condition] === true);
  if (safety.length) return {
    outcome: 'BLOCKED',
    selected_policy: null,
    reason_code: 'SAFETY_PROHIBITION',
    conflicts: safety
  };
  if (context.explicit_current_cancellation === true) return {
    outcome: 'BLOCKED',
    selected_policy: null,
    reason_code: 'EXPLICIT_CURRENT_CANCELLATION',
    conflicts: ['explicit_current_cancellation']
  };
  if (context.technical_evidence_verified === false || context.logistics_compatible === false) return {
    outcome: 'HUMAN_REVIEW',
    selected_policy: null,
    reason_code: context.technical_evidence_verified === false
      ? 'TECHNICAL_EVIDENCE_NOT_VERIFIED'
      : 'LOGISTICS_STATE_INCOMPATIBLE',
    conflicts: ['evidence_or_logistics_conflict']
  };

  const candidates = policies.filter((policy) => policy.enabled !== false);
  if (!candidates.length) return {
    outcome: 'HUMAN_REVIEW',
    selected_policy: null,
    reason_code: 'NO_APPLICABLE_POLICY',
    conflicts: []
  };
  const ranked = candidates.toSorted(comparePolicyRank);
  const first = ranked[0];
  const tied = ranked.filter((policy) => sameDeterministicRank(policy, first));
  const incompatible = new Set(tied.map((policy) => policy.proposed_action)).size > 1;
  if (tied.length > 1 && incompatible) return {
    outcome: 'HUMAN_REVIEW',
    selected_policy: null,
    reason_code: 'UNRESOLVED_POLICY_TIE',
    conflicts: tied.map((policy) => policy.policy_id)
  };
  return {
    outcome: 'SELECTED',
    selected_policy: structuredClone(first),
    rejected_policies: ranked.slice(1).map((policy) => policy.policy_id),
    reason_code: 'DETERMINISTIC_POLICY_RANK'
  };
}
