import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDropeaV2Webhook } from './dropea-v2-ingress.mjs';

const SECRET = 'fixture-hmac-secret-with-at-least-32-characters';
const TOKEN = 'fixture_path_token_abcdefghijklmnopqrstuvwxyz123456';
const NOW = new Date('2026-08-04T12:00:00Z').getTime();

function input(eventAt = '2026-08-04T11:59:00Z') {
  const payload = { topic: 'order.status.changed', market: 'ES', event_id: 'event-fixture', event_at: eventAt,
    resource_id: 42, resource: { id: 42, status: 'SHIPPING' } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  return { rawBody, headers: { 'content-type': 'application/json', 'x-dropea-topic': payload.topic,
    'x-dropea-event-id': payload.event_id,
    'x-dropea-signature': `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('base64')}` } };
}

test('webhook accepts HMAC and controlled path-token fallback without exposing either', () => {
  const hmac = prepareDropeaV2Webhook({ ...input(), market: 'ES', storeId: 17, hmacSecret: SECRET, now: () => NOW });
  assert.equal(hmac.auth_status, 'HMAC_VALID');
  const path = prepareDropeaV2Webhook({ ...input(), headers: { ...input().headers, 'x-dropea-signature': 'bad' },
    market: 'ES', storeId: 17, authMode: 'HMAC_THEN_PATH_TOKEN', pathToken: TOKEN,
    pathTokenSha256: crypto.createHash('sha256').update(TOKEN).digest('hex'), now: () => NOW });
  assert.equal(path.auth_status, 'PATH_TOKEN_VALID');
  assert.equal(JSON.stringify(path).includes(TOKEN), false);
});

test('webhook rejects unauthenticated requests and marks controlled late events', () => {
  assert.throws(() => prepareDropeaV2Webhook({ ...input(), market: 'ES', storeId: 17, hmacSecret: 'wrong'.repeat(10), now: () => NOW }), { code: 'WEBHOOK_AUTH_FAILED' });
  const late = prepareDropeaV2Webhook({ ...input('2026-08-02T11:00:00Z'), market: 'ES', storeId: 17, hmacSecret: SECRET, now: () => NOW });
  assert.equal(late.late_event, true);
});
