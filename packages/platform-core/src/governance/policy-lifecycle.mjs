import { POLICY_STATUSES } from './contracts.mjs';

const TRANSITIONS = Object.freeze({
  DRAFT: ['SIMULATION', 'DEPRECATED'],
  SIMULATION: ['APPROVED_FOR_STAGING', 'DEPRECATED'],
  APPROVED_FOR_STAGING: ['APPROVED_FOR_SHADOW', 'ROLLED_BACK', 'DEPRECATED'],
  APPROVED_FOR_SHADOW: ['ROLLED_BACK', 'DEPRECATED'],
  APPROVED_FOR_PRODUCTION: ['ROLLED_BACK', 'DEPRECATED'],
  DEPRECATED: [],
  ROLLED_BACK: []
});

export function transitionPolicy(policy, nextStatus, {
  actor = 'system',
  explicitOwnerApproval = false,
  now = new Date()
} = {}) {
  if (!POLICY_STATUSES.includes(nextStatus)) throw new Error(`Unsupported target status: ${nextStatus}`);
  if (nextStatus === 'APPROVED_FOR_PRODUCTION') {
    throw new Error('Automatic transition to APPROVED_FOR_PRODUCTION is forbidden');
  }
  if (!(TRANSITIONS[policy.status] ?? []).includes(nextStatus)) {
    throw new Error(`Invalid policy transition: ${policy.status} -> ${nextStatus}`);
  }
  if (!explicitOwnerApproval && ['APPROVED_FOR_STAGING', 'APPROVED_FOR_SHADOW'].includes(nextStatus)) {
    throw new Error(`${nextStatus} requires explicit owner approval`);
  }
  return Object.freeze({
    ...structuredClone(policy),
    status: nextStatus,
    lifecycle_record: Object.freeze({
      previous_status: policy.status,
      next_status: nextStatus,
      actor,
      transitioned_at: new Date(now).toISOString(),
      explicit_owner_approval: explicitOwnerApproval
    })
  });
}

export { TRANSITIONS as POLICY_LIFECYCLE_TRANSITIONS };
