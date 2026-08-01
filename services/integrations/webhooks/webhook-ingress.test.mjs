import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventStore } from '../../../packages/platform-core/src/event-store.mjs';
import { LocalIngestionPipeline } from '../../../packages/platform-core/src/ingestion-pipeline.mjs';
import { receiveDropeaWebhook } from './dropea-webhook.mjs';
import { receiveChatbyWebhook } from './chatby-webhook.mjs';

const SECRET = 'fixture-webhook-secret-at-least-32-characters';
const HMAC_KEY = 'fixture-technical-hmac-key-at-least-32-characters';
const NOW = new Date('2026-08-01T12:00:00.000Z').getTime();

function signed(body, prefix, extra = {}) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      [`x-${prefix}-topic`]: body.topic,
      [`x-${prefix}-event-id`]: body.event_id,
      [`x-${prefix}-signature`]: `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('base64')}`,
      ...extra
    }
  };
}

function dropeaPayload(overrides = {}) {
  return {
    topic: 'order.status.changed', market: 'ES', event_id: '00000000-0000-4000-8000-000000000001',
    event_at: '2026-08-01T11:59:00.000Z', resource_id: 24,
    resource: { id: 24, status: 'SHIPPING', sub_status: 'SHIPPED', line_items: [], total_amount: 1, currency: 'EUR', created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-01T11:59:00.000Z' },
    ...overrides
  };
}

function pipeline() {
  const store = new InMemoryEventStore();
  return { store, ingestionPipeline: new LocalIngestionPipeline(store) };
}

test('Dropea webhook validates raw-body HMAC, headers, schema and persists once', async () => {
  const { store, ingestionPipeline } = pipeline();
  const input = signed(dropeaPayload(), 'dropea');
  let queued = 0;
  const receive = () => receiveDropeaWebhook({
    ...input, secret: SECRET, ingestionPipeline, now: () => NOW,
    resolveIdentity: () => ({ canonical_order_id: 'order-fixture', status: 'EXACT' }),
    enqueue: () => { queued += 1; }
  });
  const first = receive();
  const duplicate = receive();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(store.list().length, 1);
  assert.equal(queued, 1);
  assert.equal(first.actions_executed, 0);
});

test('Dropea webhook rejects tampering, mismatched topic, stale timestamp and market', () => {
  const { ingestionPipeline } = pipeline();
  const base = { secret: SECRET, ingestionPipeline, now: () => NOW, resolveIdentity: () => ({ canonical_order_id: 'order-fixture', status: 'EXACT' }) };
  const tampered = signed(dropeaPayload(), 'dropea');
  tampered.rawBody = Buffer.from(`${tampered.rawBody.toString()} `);
  assert.throws(() => receiveDropeaWebhook({ ...tampered, ...base }), { code: 'WEBHOOK_SIGNATURE_INVALID' });
  const wrongTopic = signed(dropeaPayload(), 'dropea', { 'x-dropea-topic': 'order.created' });
  assert.throws(() => receiveDropeaWebhook({ ...wrongTopic, ...base }), { code: 'WEBHOOK_TOPIC_MISMATCH' });
  const stale = signed(dropeaPayload({ event_at: '2026-07-30T11:00:00.000Z' }), 'dropea');
  assert.throws(() => receiveDropeaWebhook({ ...stale, ...base }), { code: 'WEBHOOK_TIMESTAMP_STALE' });
  const market = signed(dropeaPayload({ market: 'XX' }), 'dropea');
  assert.throws(() => receiveDropeaWebhook({ ...market, ...base }), { code: 'WEBHOOK_MARKET_BLOCKED' });
});

test('Dropea webhook rejects oversized/non-JSON content and resource mismatches', () => {
  const { ingestionPipeline } = pipeline();
  const base = { secret: SECRET, ingestionPipeline, now: () => NOW, resolveIdentity: () => ({ canonical_order_id: 'order-fixture', status: 'EXACT' }) };
  const input = signed(dropeaPayload({ resource_id: 25 }), 'dropea');
  assert.throws(() => receiveDropeaWebhook({ ...input, ...base }), /RESOURCE_ID_MISMATCH/);
  assert.throws(() => receiveDropeaWebhook({ ...input, ...base, headers: { ...input.headers, 'content-type': 'text/plain' } }), { code: 'WEBHOOK_CONTENT_TYPE_INVALID' });
  assert.throws(() => receiveDropeaWebhook({
    ...base,
    rawBody: Buffer.alloc(1_048_577),
    headers: { 'content-type': 'application/json' }
  }), { code: 'WEBHOOK_BODY_TOO_LARGE' });
});

test('Chatby webhook requires exact identity, masks content and hashes technical IDs', async () => {
  const { store, ingestionPipeline } = pipeline();
  const body = {
    topic: 'message.incoming', event_id: '00000000-0000-4000-8000-000000000002',
    event_at: '2026-08-01T11:59:00.000Z', conversation_id: 'fixture-conversation',
    message_id: 'fixture-message', direction: 'incoming', content: 'Customer free text'
  };
  const input = signed(body, 'chatby');
  const result = receiveChatbyWebhook({
    ...input, secret: SECRET, technicalHmacKey: HMAC_KEY, ingestionPipeline, now: () => NOW,
    resolveIdentity: () => ({ canonical_order_id: 'order-fixture', status: 'VERIFIED' })
  });
  await new Promise((resolve) => setImmediate(resolve));
  const event = store.list()[0];
  assert.equal(result.inserted, true);
  assert.equal('content' in event.payload, false);
  assert.equal(event.payload.content_present, true);
  assert.notEqual(event.payload.content_hash, body.content);
  assert.notEqual(event.payload.chatby_ref_hash, body.conversation_id);
  assert.equal(result.messages_sent, 0);
  const otherPipeline = pipeline().ingestionPipeline;
  assert.throws(() => receiveChatbyWebhook({
    ...input, secret: SECRET, technicalHmacKey: HMAC_KEY, ingestionPipeline: otherPipeline, now: () => NOW,
    resolveIdentity: () => ({ canonical_order_id: 'order-fixture', status: 'PARTIAL' })
  }), /IDENTITY_NOT_EXACT_OR_VERIFIED/);
});
