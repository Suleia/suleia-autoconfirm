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
  const privateMessages = [];
  const available = [];
  let candidateQuery = '';
  const pool = { query: async (statement) => { candidateQuery = statement; return ({ rows: [{
    canonical_order_id: 'order-hash-safe',
    external_order_id_hash: exactHash,
    dropea_order_id: 'DROPEA-24',
    order_created_at: '2026-08-01T08:00:00Z',
    canonical_issue_id: 'issue-hash-safe',
    issue_created_at: '2026-08-01T09:00:00Z',
    issue_updated_at: '2026-08-01T09:05:00Z'
  }] }); } };
  const projector = {
    recordChatbyConversationEvent: async (event) => { recorded.push(event); return { inserted: true }; },
    upsertChatbyPrivateMessageDisplay: async (event) => { privateMessages.push(event); return { inserted: true }; },
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
      { id: 'operator-question', type: 'out', msg_type: 'text', ts: Date.parse('2026-08-01T09:30:00Z'), content: '¿Quiere recibir el pedido?' },
      { id: 'current-message', type: 'in', msg_type: 'postback', ts: Date.parse('2026-08-01T10:00:00Z'), payload: { title: 'Quiero el descuento' }, content: 'customer@example.com +34612345678' }
    ], meta: { current_page: 1, last_page: 1 } });
  };

  const result = await syncChatbyReadOnly({
    pool, projector, token: 'test-token', hmacKey: key, fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(result.exact_orders, 1);
  assert.equal(result.events_inserted, 2);
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1].intent, 'DISCOUNT_ACCEPTED');
  assert.equal(recorded[1].button_payload, 'DISCOUNT_ACCEPTED');
  assert.equal(recorded[1].sanitized_text, 'INTENT:DISCOUNT_ACCEPTED');
  assert.doesNotMatch(JSON.stringify(recorded), /customer@example|612345678|conversation-private-id|contact-private-id/);
  assert.equal(privateMessages.length, 3);
  assert.match(privateMessages[2].message_text_ciphertext, /^v1:/);
  assert.doesNotMatch(JSON.stringify(privateMessages), /customer@example|612345678/);
  assert.equal(privateMessages[0].relation_to_issue, 'BEFORE_INCIDENT');
  assert.equal(privateMessages[1].direction, 'INBOUND');
  assert.equal(privateMessages[2].direction, 'OUTBOUND');
  assert.equal(privateMessages[2].relation_to_issue, 'AFTER_INCIDENT');
  assert.deepEqual(available, [{ canonical_order_id: 'order-hash-safe', canonical_issue_id: 'issue-hash-safe' }]);
  assert.deepEqual(calls.map((call) => call.options.method), ['GET', 'GET']);
  assert.equal(calls.every((call) => call.options.body === undefined), true);
  assert.match(candidateQuery, /i\.is_active=true OR i\.updated_at_utc >= now\(\)-interval '14 days'/);
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

test('Chatby mirror recovers a conversation from the exact technical order id inside Dropea payload', async () => {
  const links = [];
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-v2-safe', external_order_id_hash: 'a'.repeat(64),
    dropea_order_id: '198765', canonical_issue_id: 'issue-v2-safe',
    issue_created_at: '2026-08-01T09:00:00Z', issue_updated_at: '2026-08-01T09:05:00Z'
  }] }) };
  const fetchImpl = async (url) => new URL(url).pathname.endsWith('/subscribers')
    ? response({ data: [{
      user_ns: 'conversation-safe', user_id: 'contact-safe',
      user_fields: [
        { name: 'Dropea: Número', value: 'legacy-issue-id' },
        { name: '[Dropea] Issue Payload', value: JSON.stringify({ order_id: '198765', order: { id: '198765' } }) }
      ]
    }], meta: { current_page: 1, last_page: 1 } })
    : response({ data: [{ id: 'm1', type: 'in', msg_type: 'text', ts: Date.parse('2026-08-01T10:00:00Z'), content: 'Confirmo' }], meta: { current_page: 1, last_page: 1 } });
  const result = await syncChatbyReadOnly({
    pool,
    projector: {
      recordChatbyConversationEvent: async () => ({ inserted: true }),
      upsertChatbyConversationLink: async (value) => links.push(value),
      markChatbyConversationAvailable: async () => ({ available: true })
    },
    token: 'test-token', hmacKey: key, fetchImpl
  });
  assert.equal(result.available_issues, 1);
  assert.equal(result.conversation_statuses.FOUND, 1);
  assert.equal(links[0].conversation_status, 'FOUND');
  assert.match(links[0].identity_method, /^CHATBY_PAYLOAD:/);
  assert.equal(links[0].customer_replied, true);
});

test('Chatby mirror records the exact cause when no technical conversation reference exists', async () => {
  const links = [];
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-safe', external_order_id_hash: 'a'.repeat(64),
    dropea_order_id: '198765', canonical_issue_id: 'issue-safe',
    issue_created_at: '2026-08-01T09:00:00Z', issue_updated_at: '2026-08-01T09:05:00Z'
  }] }) };
  const result = await syncChatbyReadOnly({
    pool,
    projector: { upsertChatbyConversationLink: async (value) => links.push(value) },
    token: 'test-token', hmacKey: key,
    fetchImpl: async () => response({ data: [{ user_ns: 'unrelated', user_fields: [] }], meta: { current_page: 1, last_page: 1 } })
  });
  assert.equal(result.conversation_statuses.NONE, 1);
  assert.equal(links[0].reason_code, 'NO_EXACT_TECHNICAL_REFERENCE');
  assert.equal(result.external_methods[0], 'GET');
});

test('Chatby mirror reuses the subscriber catalogue while continuing current-issue cycles', async () => {
  let fetchCalls = 0;
  let clock = 1_000;
  const subscriberCache = {};
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-safe', external_order_id_hash: 'a'.repeat(64),
    dropea_order_id: '198765', canonical_issue_id: 'issue-safe',
    issue_created_at: '2026-08-01T09:00:00Z', issue_updated_at: '2026-08-01T09:05:00Z'
  }] }) };
  const input = {
    pool,
    projector: { upsertChatbyConversationLink: async () => {} },
    token: 'test-token', hmacKey: key,
    subscriberCache, subscriberCacheTtlMs: 900_000,
    minRequestIntervalMs: 0, retryBaseMs: 0,
    now: () => clock,
    fetchImpl: async () => {
      fetchCalls += 1;
      return response({ data: [{ user_ns: 'unrelated', user_fields: [] }], meta: { current_page: 1, last_page: 1 } });
    }
  };
  const first = await syncChatbyReadOnly(input);
  clock += 300_000;
  const second = await syncChatbyReadOnly(input);
  assert.equal(first.subscriber_cache_hit, false);
  assert.equal(second.subscriber_cache_hit, true);
  assert.equal(fetchCalls, 1);
});

test('conversation metrics keep a successful read fresh while separating old activity', () => {
  const metrics = chatbyReadOnlyInternals.conversationMetrics([
    { id: 'old-out', type: 'out', msg_type: 'template', ts: Date.parse('2026-07-01T10:00:00Z') },
    { id: 'old-in', type: 'in', msg_type: 'postback', ts: Date.parse('2026-07-01T11:00:00Z'), payload: { title: 'No quiero el pedido' } }
  ], '2026-08-01T09:00:00Z', new Date('2026-08-02T09:00:00Z'));
  assert.equal(metrics.customer_replied, false);
  assert.equal(metrics.conversation_freshness, 'FRESH');
  assert.equal(metrics.last_button, 'FINAL_REJECTION');
  assert.equal(metrics.message_count, 2);
  assert.equal(metrics.customer_messages[0].relation_to_issue, 'BEFORE_INCIDENT');
});

test('Chatby deterministic classifier recognizes the supported operational intents', () => {
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ payload: { title: 'No quiero el pedido' } }), 'FINAL_REJECTION');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ content: 'Quiero recogerlo en agencia' }), 'PICKUP_AT_AGENCY');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ content: 'Necesito cambiar la dirección' }), 'CHANGE_ADDRESS');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ content: 'Confirmo que quiero que se entregue mañana por la mañana o por la tarde y llamad antes de entregar' }), 'DELIVERY_RETRY');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ payload: { title: 'Mañana por mañana / tarde' } }), 'DELIVERY_RETRY');
  assert.equal(chatbyReadOnlyInternals.classifyIntent({ content: 'mensaje sin decisión' }), 'UNKNOWN');
});
