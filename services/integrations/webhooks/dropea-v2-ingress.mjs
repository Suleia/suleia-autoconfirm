import crypto from 'node:crypto';
import { DROPEA_WEBHOOK_TOPICS } from './dropea-webhook.mjs';

export class DropeaWebhookIngressError extends Error {
  constructor(message, code, status = 400) {
    super(message); this.name = 'DropeaWebhookIngressError'; this.code = code; this.status = status;
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function header(headers, name) {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

function validateHmac(rawBody, signature, secret) {
  if (!secret || String(secret).length < 32) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('base64')}`;
  return safeEqual(signature || '', expected);
}

function validatePathToken(pathToken, expectedHash) {
  if (!pathToken || !/^[A-Za-z0-9_-]{32,256}$/.test(pathToken) || !/^[a-f0-9]{64}$/i.test(expectedHash || '')) return false;
  return safeEqual(crypto.createHash('sha256').update(pathToken).digest('hex'), expectedHash);
}

export function prepareDropeaV2Webhook({
  rawBody, headers, market, storeId, pathToken = null, authMode = 'HMAC_ONLY',
  hmacSecret = null, pathTokenSha256 = null, now = Date.now, maxBytes = 1_048_576,
  maxFutureMs = 5 * 60_000, maxLateMs = 90 * 24 * 60 * 60_000
}) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) throw new DropeaWebhookIngressError('Webhook body is empty', 'WEBHOOK_BODY_EMPTY');
  if (rawBody.length > maxBytes) throw new DropeaWebhookIngressError('Webhook body exceeds limit', 'WEBHOOK_BODY_TOO_LARGE', 413);
  if (!String(header(headers, 'content-type') || '').toLowerCase().startsWith('application/json')) {
    throw new DropeaWebhookIngressError('Webhook content type is invalid', 'WEBHOOK_CONTENT_TYPE_INVALID', 415);
  }
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { throw new DropeaWebhookIngressError('Webhook JSON is invalid', 'WEBHOOK_JSON_INVALID'); }
  const normalizedMarket = String(market).toUpperCase();
  if (!['ES','IT','PT'].includes(normalizedMarket) || String(payload.market).toUpperCase() !== normalizedMarket) {
    throw new DropeaWebhookIngressError('Webhook market mismatch', 'WEBHOOK_MARKET_MISMATCH');
  }
  if (!DROPEA_WEBHOOK_TOPICS.includes(payload.topic) || header(headers, 'x-dropea-topic') !== payload.topic) {
    throw new DropeaWebhookIngressError('Webhook topic mismatch', 'WEBHOOK_TOPIC_MISMATCH');
  }
  if (!payload.event_id || header(headers, 'x-dropea-event-id') !== payload.event_id) {
    throw new DropeaWebhookIngressError('Webhook event id mismatch', 'WEBHOOK_EVENT_ID_MISMATCH');
  }
  const eventAt = new Date(payload.event_at).getTime(); const current = now();
  if (!Number.isFinite(eventAt) || eventAt > current + maxFutureMs || eventAt < current - maxLateMs) {
    throw new DropeaWebhookIngressError('Webhook timestamp is outside the accepted replay window', 'WEBHOOK_TIMESTAMP_REJECTED', 409);
  }
  const hmacValid = ['HMAC_ONLY','HMAC_THEN_PATH_TOKEN'].includes(authMode)
    && validateHmac(rawBody, header(headers, 'x-dropea-signature'), hmacSecret);
  const pathValid = ['PATH_TOKEN_ONLY','HMAC_THEN_PATH_TOKEN'].includes(authMode)
    && validatePathToken(pathToken, pathTokenSha256);
  const authStatus = hmacValid ? 'HMAC_VALID' : pathValid ? 'PATH_TOKEN_VALID' : 'AUTH_FAILED';
  if (authStatus === 'AUTH_FAILED') throw new DropeaWebhookIngressError('Webhook authentication failed', 'WEBHOOK_AUTH_FAILED', 401);
  if (!payload.resource || String(payload.resource_id ?? '') !== String(payload.resource.id ?? '')) {
    throw new DropeaWebhookIngressError('Webhook resource mismatch', 'WEBHOOK_RESOURCE_MISMATCH');
  }
  return Object.freeze({
    event_id: String(payload.event_id), topic: payload.topic, market: normalizedMarket,
    store_id: String(storeId), resource_id: String(payload.resource_id),
    payload_hash: crypto.createHash('sha256').update(rawBody).digest('hex'),
    auth_status: authStatus, event_at: new Date(eventAt).toISOString(),
    late_event: eventAt < current - 24 * 60 * 60_000,
    ephemeral_resource: payload.resource,
    actions_executed: 0, production_writes: 0
  });
}
