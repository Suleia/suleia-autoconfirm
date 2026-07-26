const PHONE_SOURCE = String.raw`(?<!\d)(?:\+?34)?[6789]\d{8}(?!\d)`;
const PHONE = new RegExp(PHONE_SOURCE, 'g');
const DIRECT_PHONE = new RegExp(PHONE_SOURCE);
const EMAIL = /\b([A-Z0-9._%+-])([A-Z0-9._%+-]*)(@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const DNI = /\b\d{8}[A-Z]\b/gi;

export function maskText(value) {
  return String(value ?? '')
    .replace(PHONE, (phone) => `*** *** ${phone.replace(/\D/g, '').slice(-3)}`)
    .replace(EMAIL, (_, first, rest, domain) => `${first}${'*'.repeat(Math.max(1, rest.length))}${domain}`)
    .replace(DNI, '[DNI REDACTED]');
}

export function maskRecord(value) {
  if (Array.isArray(value)) return value.map(maskRecord);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? maskText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|secret|password|authorization|cookie/i.test(key)) return [key, '[REDACTED]'];
    if (/address|direccion/i.test(key)) return [key, item ? '[ADDRESS REDACTED]' : item];
    if (/^(?:name|first_name|last_name|full_name|customer_name)$/i.test(key)) {
      return [key, item ? '[NAME REDACTED]' : item];
    }
    return [key, maskRecord(item)];
  }));
}

export function containsDirectPii(value) {
  const text = JSON.stringify(value);
  return DIRECT_PHONE.test(text) || /\b\d{8}[A-Z]\b/i.test(text) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
}
