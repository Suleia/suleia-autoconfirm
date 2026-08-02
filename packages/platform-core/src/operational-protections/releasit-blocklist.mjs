import crypto from 'node:crypto';
import { normalizeSpanishPhone } from './identity.mjs';
import { classifyOrderLifecycle } from './lifecycle.mjs';

export const RELEASIT_RETURN_BLOCK_POLICY_VERSION = 'releasit-return-block-v1.0.0';

export function releasitIdempotencyKey(canonicalOrderId, phoneHash) {
  return crypto.createHash('sha256')
    .update(['RELEASIT_RETURN_BLOCK', canonicalOrderId, phoneHash, RELEASIT_RETURN_BLOCK_POLICY_VERSION].join('|'))
    .digest('hex');
}
export function mergeBlockedPhoneList(existingText, phoneToAdd, { testPhoneNormalized } = {}) {
  const originalLines = String(existingText || '').split(/\r?\n/);
  const normalizedNew = normalizeSpanishPhone(phoneToAdd);
  const normalizedTest = normalizeSpanishPhone(testPhoneNormalized);
  if (!normalizedNew) return Object.freeze({ status: 'INVALID_PHONE', changed: false, value: String(existingText || ''), count: originalLines.filter((line) => line.trim()).length });
  if (normalizedTest && normalizedNew === normalizedTest) return Object.freeze({ status: 'EXCLUDED_TEST_PHONE', changed: false, value: String(existingText || ''), count: originalLines.filter((line) => line.trim()).length });
  const existingNormalized = new Set(originalLines.map(normalizeSpanishPhone).filter(Boolean));
  if (existingNormalized.has(normalizedNew)) return Object.freeze({ status: 'ALREADY_BLOCKED', changed: false, value: String(existingText || ''), count: existingNormalized.size });
  const preserved = originalLines.filter((line) => line.trim());
  const value = [...preserved, normalizedNew].join('\n');
  return Object.freeze({ status: 'BLOCK_ELIGIBLE', changed: true, value, count: existingNormalized.size + 1 });
}

export function evaluateReturnBlockEligibility({ order, identity_status, phone, phone_hash, testPhoneNormalized } = {}) {
  const lifecycle = classifyOrderLifecycle(order);
  const normalized = normalizeSpanishPhone(phone);
  const test = normalizeSpanishPhone(testPhoneNormalized);
  let status = 'BLOCK_ELIGIBLE';
  if (lifecycle.lifecycle !== 'TERMINAL' || lifecycle.source_state !== 'RETURN_TO_ORIGIN_COMPLETED') status = 'NOT_ELIGIBLE';
  else if (!['EXACT', 'VERIFIED'].includes(String(identity_status).toUpperCase())) status = 'MANUAL_REVIEW';
  else if (!normalized || !phone_hash) status = 'MANUAL_REVIEW';
  else if (test && normalized === test) status = 'EXCLUDED_TEST_PHONE';
  else if (order?.is_test_order === true || order?.is_internal_order === true) status = 'NOT_ELIGIBLE';
  return Object.freeze({
    status,
    eligible: status === 'BLOCK_ELIGIBLE',
    phone_last4: normalized?.slice(-4) || null,
    reason: 'RETURN_TO_ORIGIN',
    policy_version: RELEASIT_RETURN_BLOCK_POLICY_VERSION,
    actions_executed: 0
  });
}

export async function synchronizeReleasitBlocklist({ client, phone, testPhoneNormalized, writeEnabled = false, officialCapabilityVerified = false, maxAttempts = 3 } = {}) {
  if (!client?.read) throw new Error('Releasit reader is required');
  if (writeEnabled && (!officialCapabilityVerified || !client.write)) throw new Error('Official Releasit write capability is not verified');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const before = await client.read();
    const merged = mergeBlockedPhoneList(before.value, phone, { testPhoneNormalized });
    if (!merged.changed) return Object.freeze({ ...merged, attempts: attempt, verified: merged.status === 'ALREADY_BLOCKED', actions_executed: 0 });
    if (!writeEnabled) return Object.freeze({ ...merged, status: 'BLOCK_PENDING', attempts: attempt, verified: false, actions_executed: 0 });
    const write = await client.write({ value: merged.value, expectedVersion: before.version });
    if (write?.conflict) continue;
    const after = await client.read();
    if (after.value === merged.value && mergeBlockedPhoneList(after.value, phone, { testPhoneNormalized }).status === 'ALREADY_BLOCKED') {
      return Object.freeze({ status: 'BLOCKED_VERIFIED', changed: true, value: after.value, attempts: attempt, verified: true, actions_executed: 1 });
    }
    throw new Error('RELEASIT_VERIFICATION_FAILED');
  }
  throw new Error('RELEASIT_WRITE_CONFLICT');
}
