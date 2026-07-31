import { containsDirectPii } from '../masking.mjs';

const SECRET_PATTERN = /(?:sk-[a-z0-9_-]{12,}|rnd_[a-z0-9]{12,}|bearer\s+[a-z0-9._-]{12,}|password\s*[:=])/i;

function containsSecret(value) {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => {
      if (key === 'authorization_present' && typeof item === 'boolean') return false;
      return /token|secret|password|authorization|cookie/i.test(key)
        ? item !== '[REDACTED]' && item !== null && item !== ''
        : containsSecret(item);
    });
  }
  return typeof value === 'string' && SECRET_PATTERN.test(value);
}

export function evaluateTechnicalCompliance({
  record,
  data_minimized = false,
  pii_classified = false,
  retention_days,
  allowed_retention_days = [],
  role_authorized = false,
  traceable = false,
  declared_purpose,
  safe_logs = false,
  export_controlled = false
}) {
  const failures = [];
  if (!data_minimized) failures.push('DATA_NOT_MINIMIZED');
  if (!pii_classified) failures.push('PII_NOT_CLASSIFIED');
  if (containsDirectPii(record)) failures.push('PII_NOT_MASKED');
  if (containsSecret(record)) failures.push('SECRET_EXPOSED');
  if (!Number.isInteger(retention_days) || !allowed_retention_days.includes(retention_days)) failures.push('RETENTION_INVALID');
  if (!role_authorized) failures.push('ACCESS_NOT_AUTHORIZED');
  if (!traceable) failures.push('TRACEABILITY_MISSING');
  if (typeof declared_purpose !== 'string' || !declared_purpose) failures.push('PURPOSE_NOT_DECLARED');
  if (!safe_logs) failures.push('UNSAFE_LOGGING');
  if (!export_controlled) failures.push('EXPORT_NOT_CONTROLLED');
  return Object.freeze({
    compliance_result: failures.length ? 'BLOCKED' : 'PASS',
    failures: Object.freeze(failures),
    legal_interpretation_performed: false,
    deletion_executed: false,
    retention_changed: false
  });
}

export { containsSecret };
