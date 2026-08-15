import crypto from 'node:crypto';

const SENSITIVE_KEY = /(name|phone|email|address|street|city|postal|zip|dni|nif|document|conversation|message|raw|payload)/i;
const TECHNICAL_NAME_KEY = /^(schema_name|object_name|column_name|constraint_name|index_name|trigger_name|function_name)$/i;
const PHONE = /(?:\+\d{9,15}\b|\b[6-9]\d{8}\b)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function stableToken(prefix, value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
  return `${prefix}_${digest}`;
}

export function maskScalar(key, value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (/phone/i.test(key)) return stableToken('phone_hash', text);
  if (/email/i.test(key)) return stableToken('email_hash', text);
  if (/name/i.test(key)) return 'Cliente enmascarado';
  if (/(address|street|city|postal|zip)/i.test(key)) return stableToken('address_hash', text);
  if (/(dni|nif|document)/i.test(key)) return stableToken('document_hash', text);
  if (typeof value !== 'string') return value;
  return text.replace(EMAIL, '[email_masked]').replace(PHONE, '[phone_masked]');
}

export function maskPii(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => maskPii(item, key));
  // pg materializes timestamptz columns as Date instances. Treating a Date as
  // a generic object produces `{}` because Date has no enumerable properties.
  // Serialize at the security boundary so API and MCP contracts always expose
  // ISO 8601 UTC strings (or null for an invalid timestamp).
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (!value || typeof value !== 'object') return maskScalar(key, value);

  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (/^(raw|payload|conversation|messages?)$/i.test(childKey)) continue;
    const descriptorName = childKey === 'name' && (
      (Object.hasOwn(value, 'position') && Object.hasOwn(value, 'type'))
      || Object.hasOwn(value, 'definition')
      || Object.hasOwn(value, 'enabled')
    );
    if (TECHNICAL_NAME_KEY.test(childKey) || descriptorName) {
      // Database catalog identifiers are operational metadata, not a person's
      // name. Still scan their string value for accidental phone/e-mail data.
      output[childKey] = maskPii(childValue, 'technical_identifier');
      continue;
    }
    output[childKey] = SENSITIVE_KEY.test(childKey)
      ? maskPii(maskScalar(childKey, childValue), childKey)
      : maskPii(childValue, childKey);
  }
  return output;
}

export function containsObviousPii(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  EMAIL.lastIndex = 0;
  PHONE.lastIndex = 0;
  return EMAIL.test(text) || PHONE.test(text);
}
