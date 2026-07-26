import crypto from 'node:crypto';

const SENSITIVE_KEY = /(name|phone|email|address|street|city|postal|zip|dni|nif|document|conversation|message|raw|payload)/i;
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
  if (!value || typeof value !== 'object') return maskScalar(key, value);

  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (/^(raw|payload|conversation|messages?)$/i.test(childKey)) continue;
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
