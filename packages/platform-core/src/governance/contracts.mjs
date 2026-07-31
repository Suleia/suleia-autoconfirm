export const GOVERNANCE_SCHEMA_VERSION = '1.0.0';

export const POLICY_STATUSES = Object.freeze([
  'DRAFT',
  'SIMULATION',
  'APPROVED_FOR_STAGING',
  'APPROVED_FOR_SHADOW',
  'APPROVED_FOR_PRODUCTION',
  'DEPRECATED',
  'ROLLED_BACK'
]);

export const POLICY_REQUIRED_FIELDS = Object.freeze([
  'policy_id',
  'name',
  'version',
  'status',
  'scope',
  'priority',
  'trigger',
  'required_evidence',
  'forbidden_conditions',
  'timer_definition',
  'proposed_action',
  'fallback',
  'human_review_conditions',
  'owner',
  'effective_from',
  'effective_until',
  'rollback_version',
  'change_reason',
  'schema_version'
]);

export const RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const QA_RESULTS = Object.freeze(['PASS', 'PASS_WITH_WARNING', 'HUMAN_REVIEW', 'BLOCKED']);
export const COMPLIANCE_RESULTS = Object.freeze(['PASS', 'BLOCKED']);

export const GOVERNANCE_EVENT_TYPES = Object.freeze([
  'PolicyLoaded',
  'PolicyRejected',
  'PolicyEvaluated',
  'PolicyConflictDetected',
  'RiskEvaluated',
  'QAEvaluated',
  'ComplianceEvaluated',
  'DecisionProposed',
  'DecisionBlocked',
  'HumanReviewRequested'
]);

export const SAFE_PROPOSED_ACTIONS = Object.freeze([
  'NO_ACTION',
  'PROPOSE_CONFIRM',
  'PROPOSE_INCIDENT_POLICY_REVIEW',
  'PROPOSE_COMMERCIAL_RECOVERY',
  'REQUEST_HUMAN_REVIEW',
  'COMPARE_LEGACY_36H_ONLY'
]);

const POISON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SAFE_KEY = /^[a-z][a-z0-9_]*$/i;
const POLICY_ID = /^[a-z][a-z0-9._-]{2,79}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeTree(value, path = 'policy') {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`${path} contains an unsupported value`);
  }
  if (typeof value === 'string' && value.length > 2_000) {
    throw new Error(`${path} contains an oversized string`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeTree(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    if (!isPlainRecord(value)) throw new Error(`${path} must contain plain records only`);
    for (const [key, item] of Object.entries(value)) {
      if (POISON_KEYS.has(key) || !SAFE_KEY.test(key)) throw new Error(`${path} contains unsafe key: ${key}`);
      assertSafeTree(item, `${path}.${key}`);
    }
  }
}

function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must be a string array`);
  }
}

function assertDate(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return;
  assertString(value, field);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO date`);
}

export function compareVersions(left, right) {
  const parse = (value) => {
    if (!VERSION.test(String(value))) throw new Error(`Invalid semantic version: ${value}`);
    return String(value).split('.').map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function validatePolicy(policy, { allowProduction = false } = {}) {
  if (!isPlainRecord(policy)) throw new Error('Policy must be a plain record');
  assertSafeTree(policy);
  const missing = POLICY_REQUIRED_FIELDS.filter((field) => !(field in policy));
  if (missing.length) throw new Error(`Policy is missing required fields: ${missing.join(', ')}`);
  if (!POLICY_ID.test(policy.policy_id)) throw new Error('policy_id is invalid');
  assertString(policy.name, 'name');
  if (!VERSION.test(policy.version)) throw new Error('version must use semantic versioning');
  if (!POLICY_STATUSES.includes(policy.status)) throw new Error(`Unsupported policy status: ${policy.status}`);
  if (policy.status === 'APPROVED_FOR_PRODUCTION' && !allowProduction) {
    throw new Error('Phase B cannot load production-approved policies');
  }
  assertStringArray(policy.scope, 'scope');
  if (!Number.isInteger(policy.priority) || policy.priority < 0 || policy.priority > 10_000) {
    throw new Error('priority must be an integer between 0 and 10000');
  }
  if (!isPlainRecord(policy.trigger)) throw new Error('trigger must be a plain record');
  if (Object.keys(policy.trigger).some((key) => ['query', 'command', 'path', 'customer_text'].includes(key))) {
    throw new Error('trigger contains an unsafe executable or free-text field');
  }
  assertStringArray(policy.required_evidence, 'required_evidence');
  assertStringArray(policy.forbidden_conditions, 'forbidden_conditions');
  if (!isPlainRecord(policy.timer_definition)) throw new Error('timer_definition must be a plain record');
  assertString(policy.timer_definition.workflow, 'timer_definition.workflow');
  if (!Number.isFinite(policy.timer_definition.duration_hours) || policy.timer_definition.duration_hours <= 0) {
    throw new Error('timer_definition.duration_hours must be positive');
  }
  if (!SAFE_PROPOSED_ACTIONS.includes(policy.proposed_action)) {
    throw new Error(`Unsafe proposed_action: ${policy.proposed_action}`);
  }
  assertString(policy.fallback, 'fallback');
  assertStringArray(policy.human_review_conditions, 'human_review_conditions');
  assertString(policy.owner, 'owner');
  assertDate(policy.effective_from, 'effective_from');
  assertDate(policy.effective_until, 'effective_until', { nullable: true });
  if (policy.effective_until && Date.parse(policy.effective_until) <= Date.parse(policy.effective_from)) {
    throw new Error('effective_until must be after effective_from');
  }
  assertString(policy.rollback_version, 'rollback_version');
  if (policy.rollback_version !== 'DISABLE_POLICY' && !VERSION.test(policy.rollback_version)) {
    throw new Error('rollback_version must be semantic or DISABLE_POLICY');
  }
  assertString(policy.change_reason, 'change_reason');
  if (policy.schema_version !== GOVERNANCE_SCHEMA_VERSION) throw new Error('Unsupported policy schema_version');
  if (policy.enabled !== undefined && typeof policy.enabled !== 'boolean') throw new Error('enabled must be boolean');
  return structuredClone(policy);
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
