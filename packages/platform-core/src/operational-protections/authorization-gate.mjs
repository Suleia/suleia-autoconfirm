import { evaluateTestPhoneGuard } from './identity.mjs';

export const OPERATIONAL_PROTECTION_POLICY_VERSION = 'operational-protection-gate-v1.0.0';

export function evaluateOperationalProtectionGate({ phone, testPhoneNormalized, testPhoneBlockEnabled = true, identity_status, idempotency_ok, duplicate, guard, data_freshness = 'FRESH' } = {}) {
  const test = evaluateTestPhoneGuard(phone, { enabled: testPhoneBlockEnabled, testPhoneNormalized });
  const blockers = [];
  if (test.matched) blockers.push('TEST_PHONE');
  if (!['EXACT', 'VERIFIED'].includes(String(identity_status || '').toUpperCase())) blockers.push('IDENTITY_UNCERTAIN');
  if (idempotency_ok !== true) blockers.push('IDEMPOTENCY_NOT_PROVEN');
  if (duplicate?.result === 'DUPLICATE_ACTIVE_ORDER') blockers.push('DUPLICATE_ACTIVE_ORDER');
  if (guard?.acquired !== true) blockers.push('ACTIVE_PRODUCT_GUARD_NOT_ACQUIRED');
  if (data_freshness !== 'FRESH') blockers.push('PROTECTION_DATA_STALE');
  return Object.freeze({
    automatic_confirmation_allowed: blockers.length === 0,
    shipping_allowed: blockers.length === 0,
    execution_allowed: blockers.length === 0,
    human_review: blockers.length > 0,
    decision_override: blockers[0] || null,
    blockers: Object.freeze(blockers),
    route: test.matched ? 'HUMAN_REVIEW_TEST' : blockers.length ? 'HUMAN_REVIEW' : 'EXISTING_CONFIRMATION_LOGIC',
    policy_version: OPERATIONAL_PROTECTION_POLICY_VERSION
  });
}
