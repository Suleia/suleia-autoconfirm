import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncChatbyReadOnly, chatbyReadOnlyInternals } from './readonly-sync.mjs';

const key = 'chatby-readonly-test-key-that-is-long-enough';
const exactHash = crypto.createHmac('sha256', key).update('ORDER-EXACT').digest('hex');

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('Chatby mirror uses GET only, exact current-order identity and persists no raw content', async () => {
  const calls = [];
  const recorded = [];
  const available = [];
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-hash-safe',
    external_order_id_hash: exactHash,
    dropea_order_id: 'DROPEA-24',
    order_created_at: '2026-08-01T08:00:00Z',
    canonical_issue_id: 'issue-hash-safe',
    issue_created_at: '2026-08-01T09:00:00Z',
    issue_updated_at: '2026-08-01T09:05:00Z'
  }] }) };
  const projector = {
    recordChatbyConversationEvent: async (event) => { recorded.push(event); return { inserted: true }; },
    markChatbyConversationAvailable: async (value) => { available.push(value); }
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const target = new URL(url);
    if (target.pathname.endsWith('/subscribers')) {
      return response({ data: [{
        user_ns: 'conversation-private-id',
        user_id: 'contact-private-id',
        phone: '+34612345678',
        user_fields: [{ name: 'Dropea: Número', value: 'ORDER-EXACT' }]
      }], meta: { current_page: 1, last_page: 1 } });
    }
    return response({ data: [
      { id: 'old-message', type: 'in', msg_type: 'text', ts: Date.parse('2026-07-01T09:00:00Z'), content: 'stale' },
      { id: 'current-message', type: 'in', msg_type: 'postback', ts: Date.parse('2026-08-01T10:00:00Z'), payload: { title: 'Quiero el descuento' }, content: 'customer@example.com +34612345678' }
    ], meta: { current_page: 1, last_page: 1 } });
  };

  const result = await syncChatbyReadOnly({
    pool, projector, token: 'test-token', hmacKey: key, fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(result.exact_orders, 1);
  assert.equal(result.events_inserted, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].intent, 'DISCOUNT_ACCEPTED');
  assert.equal(recorded[0].button_payload, 'DISCOUNT_ACCEPTED');
  assert.equal(recorded[0].sanitized_text, 'INTENT:DISCOUNT_ACCEPTED');
  assert.doesNotMatch(JSON.stringify(recorded[0]), /customer@example|612345678|conversation-private-id|contact-private-id/);
  assert.deepEqual(available, [{ canonical_order_id: 'order-hash-safe', canonical_issue_id: 'issue-hash-safe' }]);
  assert.deepEqual(calls.map((call) => call.options.method), ['GET', 'GET']);
  assert.equal(calls.every((call) => call.options.body === undefined), true);
});

test('Chatby mirror blocks ambiguous subscribers for the same current order', async () => {
  const recorded = [];
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-hash-safe', external_order_id_hash: exactHash,
    dropea_order_id: 'DROPEA-24',
    canonical_issue_id: 'issue-hash-safe', issue_created_at: '2026-08-01T09:00:00Z',
    issue_updated_at: '2026-08-01T09:05:00Z'
  }] }) };
  const fetchImpl = async () => response({ data: [
    { user_ns: 'one', user_fields: [{ name: 'Dropea: Numero', value: 'ORDER-EXACT' }] },
    { user_ns: 'two', user_fields: [{ name: 'Dropea: Número', value: 'ORDER-EXACT' }] }
  ], meta: { current_page: 1, last_page: 1 } });
  const result = await syncChatbyReadOnly({
    pool,
    projector: {
      recordChatbyConversationEvent: async (event) => { recorded.push(event); return { inserted: true }; },
      markChatbyConversationAvailable: async () => assert.fail('ambiguous identity must stay unavailable')
    },
    token: 'test-token', hmacKey: key, fetchImpl
  });
  assert.equal(result.identity_conflicts, 1);
  assert.equal(result.exact_orders, 0);
  assert.equal(recorded.length, 0);
});

test('Chatby mirror accepts the exact Dropea order id stored by the real integration', async () => {
  const available = [];
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-safe', external_order_id_hash: 'a'.repeat(64),
    dropea_order_id: '198765', canonical_issue_id: 'issue-safe',
    issue_created_at: '2026-08-01T09:00:00Z', issue_updated_at: '2026-08-01T09:05:00Z'
  }] }) };
  const fetchImpl = async (url) => new URL(url).pathname.endsWith('/subscribers')
    ? response({ data: [{ user_ns: 'one', user_fields: [{ name: 'Dropea: Número', value: '198765' }] }], meta: { current_page: 1, last_page: 1 } })
    : response({ data: [], meta: { current_page: 1, last_page: 1 } });
  const result = await syncChatbyReadOnly({
    pool,
    projector: {
      recordChatbyConversationEvent: async () => ({ inserted: false }),
      markChatbyConversationAvailable: async (value) => { available.push(value); }
    },
    token: 'test-token', hmacKey: key, fetchImpl
  });
  assert.equal(result.exact_orders, 1);
  assert.deepEqual(available, [{ canonical_order_id: 'order-safe', canonical_issue_id: 'issue-safe' }]);
});

test('Chatby deterministic classifier recognizes the supported operational intents', () => {
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ payload: { title: 'No quiero el pedido' } }), 'FINAL_REJECTION');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ content: 'Quiero recogerlo en agencia' }), 'PICKUP_AT_AGENCY');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ content: 'Necesito cambiar la dirección' }), 'CHANGE_ADDRESS');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ content: 'mensaje sin decisión' }), 'UNKNOWN');
});
