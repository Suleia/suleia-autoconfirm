import { createHash, createHmac } from 'node:crypto';

const SECRET_KEY = /(?:secret|token|password|authorization|cookie|signature|api[_-]?key|credential|private[_-]?key)/i;
const PII_KEY = /(?:first[_-]?name|last[_-]?name|full[_-]?name|customer|email|phone|mobile|address|street|city|postal|zip|message|conversation|body|text|note|raw|payload)/i;
const ID_KEY = /(?:^id$|_id$|order[_-]?(?:id|number)|tracking[_-]?(?:id|number|code)|reference)/i;
const SAFE_KEY = /(?:^status$|_status$|^state$|_state$|^type$|_type$|currency|amount|price|total|quantity|count|score|confidence|risk|created_at|updated_at|occurred_at|timestamp|date|active|enabled|result|classification)/i;

export function stableHash(value, key) {
  return createHmac('sha256', key).update(String(value)).digest('hex');
}

function maskValue(value, field, key) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((item) => maskValue(item, field, key));
  if (typeof value === 'object') return maskRecord(value, key);
  if (ID_KEY.test(field)) return `hmac:${stableHash(value, key)}`;
  if (PII_KEY.test(field)) return '[MASKED]';
  if (SAFE_KEY.test(field) && String(value).length <= 128) return String(value).replace(/[\r\n\t]/g, ' ');
  return `hmac:${stableHash(value, key)}`;
}

export function maskRecord(record, key) {
  const masked = {};
  for (const [field, value] of Object.entries(record || {})) {
    if (SECRET_KEY.test(field)) continue;
    masked[field] = maskValue(value, field, key);
  }
  return masked;
}

export function sourceRecordHash(record, key) {
  const identifier = Object.entries(record || {}).find(([field, value]) => ID_KEY.test(field) && value !== null && value !== '');
  return stableHash(identifier ? `${identifier[0]}:${identifier[1]}` : JSON.stringify(record), key);
}

export function canonicalOrderHash(record, key) {
  const candidate = Object.entries(record || {}).find(([field, value]) => /(?:^order_id$|shopify_order_id|external_order_id|order_number)/i.test(field) && value !== null && value !== '');
  return candidate ? stableHash(`${candidate[0]}:${candidate[1]}`, key) : null;
}

export function payloadChecksum(masked) {
  return createHash('sha256').update(JSON.stringify(masked)).digest('hex');
}

export function containsDirectPii(value) {
  function inspect(current, field = '') {
    if (current === null || current === undefined || typeof current === 'boolean' || typeof current === 'number') return false;
    if (Array.isArray(current)) return current.some((item) => inspect(item, field));
    if (typeof current === 'object') {
      return Object.entries(current).some(([nestedField, nestedValue]) => SECRET_KEY.test(nestedField) || inspect(nestedValue, nestedField));
    }
    const text = String(current);
    if (text === '[MASKED]' || /^hmac:[a-f0-9]{64}$/i.test(text)) return false;
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
    return PII_KEY.test(field) && /(?:\+?34)?[6789]\d{8}/.test(text);
  }
  return inspect(value);
}
