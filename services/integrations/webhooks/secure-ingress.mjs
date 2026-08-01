import crypto from 'node:crypto';

export class WebhookValidationError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'WebhookValidationError';
    this.code = code;
    this.status = status;
  }
}

function header(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

function rawBuffer(rawBody, maxBytes) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  if (!body.length) throw new WebhookValidationError('Webhook body is empty', 'WEBHOOK_BODY_EMPTY');
  if (body.length > maxBytes) throw new WebhookValidationError('Webhook body exceeds limit', 'WEBHOOK_BODY_TOO_LARGE', 413);
  return body;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateSignature({ body, signature, secret, prefix = 'sha256=' }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new WebhookValidationError('Webhook secret is not configured safely', 'WEBHOOK_SECRET_INVALID', 503);
  }
  if (!String(signature || '').startsWith(prefix)) {
    throw new WebhookValidationError('Webhook signature is missing or malformed', 'WEBHOOK_SIGNATURE_MALFORMED', 401);
  }
  const expected = `${prefix}${crypto.createHmac('sha256', secret).update(body).digest('base64')}`;
  if (!safeEqual(signature, expected)) {
    throw new WebhookValidationError('Webhook signature is invalid', 'WEBHOOK_SIGNATURE_INVALID', 401);
  }
}

function parseJson(body) {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed;
  } catch {
    throw new WebhookValidationError('Webhook JSON is invalid', 'WEBHOOK_JSON_INVALID');
  }
}

function validateTimestamp(value, { now, maxAgeMs, maxFutureMs }) {
  const timestamp = new Date(value || '').getTime();
  if (!Number.isFinite(timestamp)) throw new WebhookValidationError('Webhook timestamp is invalid', 'WEBHOOK_TIMESTAMP_INVALID');
  const current = now();
  if (timestamp < current - maxAgeMs) throw new WebhookValidationError('Webhook timestamp is stale', 'WEBHOOK_TIMESTAMP_STALE', 409);
  if (timestamp > current + maxFutureMs) throw new WebhookValidationError('Webhook timestamp is in the future', 'WEBHOOK_TIMESTAMP_FUTURE', 409);
  return new Date(timestamp).toISOString();
}

export function validateSignedWebhook({
  rawBody,
  headers,
  secret,
  signatureHeader,
  eventIdHeader,
  topicHeader,
  timestampHeader = null,
  allowedTopics,
  allowedMarkets = null,
  maxBytes = 1_048_576,
  maxAgeMs = 24 * 60 * 60_000,
  maxFutureMs = 5 * 60_000,
  now = Date.now,
  signaturePrefix = 'sha256='
}) {
  const contentType = String(header(headers, 'content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new WebhookValidationError('Webhook Content-Type must be application/json', 'WEBHOOK_CONTENT_TYPE_INVALID', 415);
  }
  const body = rawBuffer(rawBody, maxBytes);
  validateSignature({ body, signature: header(headers, signatureHeader), secret, prefix: signaturePrefix });
  const payload = parseJson(body);
  const topic = String(header(headers, topicHeader) || '');
  const eventId = String(header(headers, eventIdHeader) || '');
  if (!eventId || eventId !== String(payload.event_id || '')) {
    throw new WebhookValidationError('Webhook event ID does not match', 'WEBHOOK_EVENT_ID_MISMATCH');
  }
  if (!allowedTopics.includes(topic) || topic !== String(payload.topic || '')) {
    throw new WebhookValidationError('Webhook topic is invalid or mismatched', 'WEBHOOK_TOPIC_MISMATCH');
  }
  if (allowedMarkets && !allowedMarkets.includes(String(payload.market || '').toUpperCase())) {
    throw new WebhookValidationError('Webhook market is not approved', 'WEBHOOK_MARKET_BLOCKED');
  }
  const timestampValue = timestampHeader ? header(headers, timestampHeader) : payload.event_at;
  const occurredAt = validateTimestamp(timestampValue, { now, maxAgeMs, maxFutureMs });
  if (payload.event_at && new Date(payload.event_at).toISOString() !== occurredAt) {
    throw new WebhookValidationError('Webhook timestamp does not match', 'WEBHOOK_TIMESTAMP_MISMATCH');
  }
  return Object.freeze({ payload, topic, event_id: eventId, occurred_at: occurredAt, raw_size: body.length });
}

export function hmacTechnicalId(value, key) {
  if (typeof key !== 'string' || key.length < 32) throw new WebhookValidationError('Technical HMAC key is invalid', 'WEBHOOK_HMAC_KEY_INVALID', 503);
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
}
