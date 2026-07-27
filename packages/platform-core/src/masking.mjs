const PHONE_SOURCE = String.raw`(?<!\d)(?:\+?34)?[6789]\d{8}(?!\d)`;
const PHONE = new RegExp(PHONE_SOURCE, 'g');
const DIRECT_PHONE = new RegExp(PHONE_SOURCE);
const EMAIL = /\b([A-Z0-9._%+-])([A-Z0-9._%+-]*)(@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const DNI = /\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/gi;
const IBAN = /\bES\d{22}\b/gi;
const PAYMENT_CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const PRIVATE_URL = /https?:\/\/[^\s"'<>]+/gi;

export function maskText(value) {
  return String(value ?? '')
    .replace(PHONE, (phone) => `*** *** ${phone.replace(/\D/g, '').slice(-3)}`)
    .replace(EMAIL, (_, first, rest, domain) => `${first}${'*'.repeat(Math.max(1, rest.length))}${domain}`)
    .replace(DNI, '[IDENTITY REDACTED]')
    .replace(IBAN, '[IBAN REDACTED]')
    .replace(PAYMENT_CARD, '[PAYMENT CARD REDACTED]')
    .replace(PRIVATE_URL, '[PRIVATE URL REDACTED]');
}

export function maskRecord(value) {
  if (Array.isArray(value)) return value.map(maskRecord);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? maskText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|secret|password|authorization|cookie/i.test(key)) return [key, '[REDACTED]'];
    if (/address|direccion|postal|postcode|zip/i.test(key)) return [key, item ? '[ADDRESS REDACTED]' : item];
    if (/phone|mobile|telefono/i.test(key)) return [key, item ? maskText(item) : item];
    if (/email|correo/i.test(key)) return [key, item ? maskText(item) : item];
    if (/dni|nie|passport|iban|card_number/i.test(key)) return [key, item ? '[IDENTITY REDACTED]' : item];
    if (/private_url|tracking_url|trackingUrl/i.test(key)) return [key, item ? '[PRIVATE URL REDACTED]' : item];
    if (/conversation|messages?|notes?|observations?|comments?|description/i.test(key)) {
      return [key, item ? '[FREE TEXT REDACTED]' : item];
    }
    if (/^(?:name|first_name|last_name|full_name|customer_name|customerName)$/i.test(key)) {
      return [key, item ? '[NAME REDACTED]' : item];
    }
    return [key, maskRecord(item)];
  }));
}

function isTechnicalIdentifier(value) {
  const text = String(value);
  return /^TODAY-MASKED-\d{4}$/.test(text)
    || /^[a-f0-9]{32,128}$/i.test(text)
    || /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(text);
}

function hasPaymentCard(value) {
  const candidates = String(value).match(/(?:\d[ -]*?){13,19}/g) || [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    let sum = 0;
    let double = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  });
}

export function containsDirectPii(value) {
  if (Array.isArray(value)) return value.some(containsDirectPii);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => {
      if (/checksum|hash|event_id|decision_id|batch_id|snapshot_version|masked_order_id/i.test(key)
        && isTechnicalIdentifier(item)) return false;
      return containsDirectPii(item);
    });
  }
  if (typeof value !== 'string' || isTechnicalIdentifier(value)) return false;
  return DIRECT_PHONE.test(value)
    || /\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/i.test(value)
    || /\bES\d{22}\b/i.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || hasPaymentCard(value);
}
