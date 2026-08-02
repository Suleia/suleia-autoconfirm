import crypto from 'node:crypto';

export const OPERATIONAL_IDENTITY_POLICY_VERSION = 'operational-identity-v1.0.0';
export const AUTOMATION_IDENTITY_STATUSES = Object.freeze(new Set(['EXACT', 'VERIFIED']));

export function normalizeSpanishPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  let national = digits;
  if (national.startsWith('0034')) national = national.slice(4);
  else if (national.startsWith('34') && national.length === 11) national = national.slice(2);
  if (!/^[6-9]\d{8}$/.test(national)) return null;
  return `+34${national}`;
}
export function phoneFingerprint(phone, hmacKey) {
  const normalized = normalizeSpanishPhone(phone);
  if (!normalized) return null;
  if (typeof hmacKey !== 'string' || hmacKey.length < 32) throw new Error('Protected HMAC key is required');
  return crypto.createHmac('sha256', hmacKey).update(normalized).digest('hex');
}

export function evaluateTestPhoneGuard(phone, { enabled = true, testPhoneNormalized } = {}) {
  const normalized = normalizeSpanishPhone(phone);
  const configured = normalizeSpanishPhone(testPhoneNormalized);
  const matched = Boolean(enabled && normalized && configured && normalized === configured);
  return Object.freeze({
    matched,
    classification: matched ? 'TEST_ORDER' : 'STANDARD_ORDER',
    route: matched ? 'HUMAN_REVIEW_TEST' : null,
    automatic_confirmation_allowed: !matched,
    execution_allowed: !matched,
    releasit_block_allowed: !matched,
    policy_version: OPERATIONAL_IDENTITY_POLICY_VERSION
  });
}

export function customerIdentity(input = {}) {
  const status = String(input.identity_status || 'UNKNOWN').toUpperCase();
  const phone = normalizeSpanishPhone(input.phone);
  const sources = [];
  let technicalValue = null;
  let technicalType = null;
  if (input.customer_id) { technicalType = 'CUSTOMER_ID'; technicalValue = String(input.customer_id); sources.push('customer_id'); }
  else if (phone) { technicalType = 'PHONE'; technicalValue = phone; sources.push('phone_normalized'); }
  else if (input.verified_chatby_contact_id) { technicalType = 'CHATBY_CONTACT_ID'; technicalValue = String(input.verified_chatby_contact_id); sources.push('chatby_contact_id'); }
  else if (input.related_technical_id) { technicalType = 'RELATED_TECHNICAL_ID'; technicalValue = String(input.related_technical_id); sources.push('related_technical_id'); }
  const comparisonAllowed = AUTOMATION_IDENTITY_STATUSES.has(status) && Boolean(technicalValue);
  return Object.freeze({
    identity_type: technicalType,
    identity_value: technicalValue,
    identity_status: status,
    identity_sources: Object.freeze(sources),
    comparison_allowed: comparisonAllowed,
    phone_normalized: phone,
    phone_last4: phone?.slice(-4) || null,
    verified_at: input.verified_at || null,
    policy_version: OPERATIONAL_IDENTITY_POLICY_VERSION
  });
}
