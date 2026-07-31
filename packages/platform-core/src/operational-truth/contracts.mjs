import crypto from 'node:crypto';

export const C0_SCHEMA_VERSION = '1.0.0';
export const TRUTH_STATUSES = Object.freeze(['OBSERVED', 'VERIFIED', 'PARTIALLY_VERIFIED', 'CONFLICTING', 'STALE', 'MISSING', 'UNSUPPORTED', 'INVALID', 'SUPERSEDED', 'UNKNOWN']);
export const IDENTITY_STATUSES = Object.freeze(['EXACT', 'VERIFIED', 'PARTIAL', 'UNKNOWN', 'CONFLICTING']);
export const CONNECTOR_STATES = Object.freeze(['HEALTHY', 'DEGRADED', 'UNSTABLE', 'STALE', 'UNAVAILABLE', 'MISCONFIGURED', 'BLOCKED']);
export const PARITY_RESULTS = Object.freeze(['MATCHED', 'PARTIAL', 'DIVERGENT', 'BLOCKED', 'NOT_COMPARABLE', 'NOT_ASSESSED']);
export const READINESS_RESULTS = Object.freeze(['NOT_READY', 'CONDITIONALLY_READY', 'SHADOW_READY', 'CANARY_READY', 'CUTOVER_READY']);
export const SOURCES = Object.freeze(['shopify', 'dropea', 'chatby', 'gls', 'system_current', 'postgresql', 'event_store', 'order_digital_twin', 'decision_memory', 'mcp']);

const FORBIDDEN_KEYS = /(?:name|phone|email|address|customer_text|access_token|api_key|password|secret)$/i;
const PHONE = /(?:\+?34[\s.-]?)?[6-9](?:[\s.-]?\d){8}\b/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function stableId(prefix, value) {
  return `${prefix}-${fingerprint(value).slice(0, 20)}`;
}

export function assertIso(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO date`);
  return value;
}

export function assertNoSensitiveData(value, path = 'record') {
  if (typeof value === 'string' && (PHONE.test(value) || EMAIL.test(value))) throw new Error(`${path} contains direct PII`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoSensitiveData(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) throw new Error(`${path}.${key} is not allowed in C0 read models`);
      assertNoSensitiveData(nested, `${path}.${key}`);
    }
  }
  return value;
}

export function zeroActionEnvelope() {
  return Object.freeze({
    run_mode: 'SIMULATION', actions_executed: 0, production_writes: 0,
    messages_sent: 0, discounts_applied: 0, orders_confirmed: 0,
    orders_cancelled: 0, orders_returned: 0, external_ai_calls: 0,
    openai_api_calls: 0
  });
}

