import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE, OWNERSHIP_FAILURE, canonicalOrderId, currentAcceptedTemplate,
  recoverOneInitialTemplate, recoveryContext, liveApi
} from './recover-one-initial-template.mjs';

function fixture(overrides = {}) {
  const createdAt = '2026-01-02T10:00:00.000Z';
  const order = { orderId: '900001', status: 'PENDING', createdAt,
    customerName: 'Cliente Ficticio', customerPhone: '000000001', orderAmount: 29.99,
    raw: { status: 'PENDING', sub_status: 'PENDING', line_items: [{ product_name: 'Producto ficticio' }],
      shipping_address: { address_line_1: 'Dirección ficticia', city: 'Ciudad ficticia', postal_code: '00000' } } };
  const subscriber = { user_ns: 'fictional-thread', phone: '000000001', channel: 'whatsapp_cloud',
    allow_send_message: false, user_fields: [{ name: '#Pedido', value: '900000' }, { name: 'CON-Payload', value: 'old' },
      { name: 'event_status', value: 'do-not-touch' }, { name: 'Unrelated', value: 'preserve' }] };
  const ledger = { template_key: 'fictional-key', template_name: TEMPLATE, order_id: order.orderId,
    status: 'failed', sent_at: null, last_error: OWNERSHIP_FAILURE };
  const template = { name: 'dropea_pedido_nuevo_v1', language: 'es_ES', status: 'APPROVED', namespace: 'fictional',
    default_values: { params: { QUICK_REPLY_1: 'existing-change-node', QUICK_REPLY_2: 'existing-confirm-node' } } };
  const proof = { mid: 'wamid.fictional', ts: Date.parse(createdAt) / 1000 + 60,
    payload: { name: template.name }, is_delivered: true };
  const calls = { claims: 0, sends: [], updates: [], finish: [] };
  let attempted = false;
  const api = {
    preflight: async () => ({ order, subscriber, ledger, template, messages: [], blocking: null, ...overrides }),
    getOrder: async id => id === order.orderId ? order : { ...order, orderId: id, status: 'CANCELLED', raw: { status: 'FINISH', sub_status: 'CANCELLED' } },
    claim: async () => { calls.claims++; return { template_key: ledger.template_key, raw: { recovery_claim_id: 'fictional-claim' } }; },
    updateField: async (_, update) => { calls.updates.push(update); subscriber.user_fields.find(field => field.name === update.field_name).value = update.value; },
    getSubscriber: async () => subscriber,
    getMessages: async () => attempted ? [proof] : [],
    markAttempted: async () => {},
    send: async payload => { calls.sends.push(payload); attempted = true; return { ok: true }; },
    finish: async (_, patch) => calls.finish.push(patch)
  };
  return { order, subscriber, ledger, template, proof, calls, api };
}

test('dry run cannot send, claim, or update customer context', async () => {
  const f = fixture();
  const result = await recoverOneInitialTemplate({ orderId: 'ES900001', api: f.api });
  assert.equal(result.dry_run, true);
  assert.equal(f.calls.claims, 0);
  assert.equal(f.calls.sends.length, 0);
  assert.equal(f.calls.updates.length, 0);
});

test('a different order authorization cannot execute', async () => {
  const f = fixture();
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', authorizedOrderId: '900002', execute: true, api: f.api }), /EXACT_ORDER_AUTHORIZATION_REQUIRED/);
  assert.equal(f.calls.claims, 0);
});

test('successful case sends once, preserves existing quick replies, and records WAMID proof', async () => {
  const f = fixture();
  const result = await recoverOneInitialTemplate({ orderId: '900001', authorizedOrderId: '900001', execute: true, api: f.api });
  assert.equal(result.accepted_by_whatsapp, true);
  assert.equal(result.duplicate_current_templates, 1);
  assert.equal(f.calls.sends.length, 1);
  assert.equal(f.calls.updates.at(-1).field_name, '#Pedido');
  assert.equal(f.calls.sends[0].content.params.QUICK_REPLY_2, 'existing-confirm-node');
  assert.equal(f.calls.finish.at(-1).status, 'sent');
  assert.equal(f.calls.finish.at(-1).mid, 'wamid.fictional');
  assert.equal(f.subscriber.user_fields.find(field => field.name === 'event_status').value, 'do-not-touch');
  assert.equal(f.subscriber.user_fields.find(field => field.name === 'Unrelated').value, 'preserve');
});

test('commercial active-duplicate guard stays active', async () => {
  const f = fixture({ blocking: { kind: 'ACTIVE_PRIOR_SAME_PRODUCT_ORDER' } });
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', api: f.api }), /ACTIVE_ORDER_BUSINESS_GUARD/);
  assert.equal(f.calls.claims, 0);
});

test('historical WhatsApp messages are not evidence of current order delivery', () => {
  const f = fixture();
  assert.equal(currentAcceptedTemplate([{ ...f.proof, ts: Date.parse(f.order.createdAt) / 1000 - 3600 }], f.order), null);
  assert.equal(currentAcceptedTemplate([f.proof], f.order)?.mid, 'wamid.fictional');
});

test('existing current delivery skips the exception', async () => {
  const f = fixture();
  f.api.preflight = async () => ({ order: f.order, messages: [f.proof] });
  const result = await recoverOneInitialTemplate({ orderId: '900001', authorizedOrderId: '900001', execute: true, api: f.api });
  assert.equal(result.sends, 0);
  assert.equal(f.calls.claims, 0);
});

test('native delivery after context refresh prevents manual send', async () => {
  const f = fixture();
  f.api.getMessages = async () => [f.proof];
  const result = await recoverOneInitialTemplate({ orderId: '900001', authorizedOrderId: '900001', execute: true, api: f.api });
  assert.equal(result.sends, 0);
  assert.equal(f.calls.sends.length, 0);
  assert.equal(f.calls.finish.at(-1).status, 'already_seen');
});

test('unknown failures must not be reclaimed', async () => {
  const f = fixture();
  f.ledger.last_error = 'Transport timeout: send outcome unknown';
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', api: f.api }), /NOT_A_PROVEN_PRE_SEND/);
});

test('recipient mismatch blocks execution', async () => {
  const f = fixture();
  f.subscriber.phone = '000000002';
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', api: f.api }), /RECIPIENT_IDENTITY_MISMATCH/);
});

test('old active context must not be overwritten', async () => {
  const f = fixture();
  f.api.getOrder = async () => f.order;
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', api: f.api }), /OLD_CONTACT_CONTEXT_NOT_SAFELY_TERMINAL/);
  assert.equal(f.calls.claims, 0);
});

test('current customer activity blocks execution', async () => {
  const f = fixture({ messages: [{ type: 'in', ts: Date.parse('2026-01-02T10:01:00Z') / 1000, payload: { text: 'fictitious response' } }] });
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', api: f.api }), /NEW_CUSTOMER_ACTIVITY_REQUIRES_REVIEW/);
});

test('atomic claim loser cannot update fields or send', async () => {
  const f = fixture();
  f.api.claim = async () => null;
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', authorizedOrderId: '900001', execute: true, api: f.api }), /ATOMIC_RECOVERY_CLAIM_NOT_ACQUIRED/);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.calls.sends.length, 0);
});

test('ambiguous transport response is never retried', async () => {
  const f = fixture();
  f.api.send = async payload => { f.calls.sends.push(payload); throw new Error('CHATBY_HTTP_503'); };
  const result = await recoverOneInitialTemplate({ orderId: '900001', authorizedOrderId: '900001', execute: true, api: f.api });
  assert.equal(result.reconciliation_required, true);
  assert.equal(f.calls.sends.length, 1);
  assert.equal(f.calls.finish.at(-1).status, 'delivery_unverified');
});

test('missing body data cannot send', () => {
  const f = fixture();
  f.order.raw.shipping_address.postal_code = '';
  assert.throws(() => recoveryContext(f.order, f.subscriber), /INITIAL_TEMPLATE_DATA_INCOMPLETE/);
  assert.throws(() => canonicalOrderId('900001,900002'), /INVALID_SINGLE_ORDER_ID/);
});

test('a new blocking purchase during context refresh prevents the send', async () => {
  const f = fixture();
  f.api.getBlockingOrder = async () => ({ kind: 'ACTIVE_PRIOR_SAME_PRODUCT_ORDER' });
  const result = await recoverOneInitialTemplate({ orderId: '900001', authorizedOrderId: '900001', execute: true, api: f.api });
  assert.equal(result.sends, 0);
  assert.equal(result.reason, 'ACTIVE_ORDER_CHANGED_BEFORE_SEND');
  assert.equal(f.calls.sends.length, 0);
});

test('only the helpers own proven pre-send context validation can be resumed', async () => {
  const f = fixture();
  f.ledger.status = 'verification_failed';
  f.ledger.last_error = 'CHATBY_HTTP_422';
  f.ledger.raw = { recovery: 'explicit_one_order_authorization', prior_pre_send_error: OWNERSHIP_FAILURE,
    recovery_external_send_started: false };
  const result = await recoverOneInitialTemplate({ orderId: '900001', api: f.api });
  assert.equal(result.eligible, true);
  f.ledger.raw.recovery_external_send_started = true;
  await assert.rejects(recoverOneInitialTemplate({ orderId: '900001', api: f.api }), /NOT_A_PROVEN_PRE_SEND/);
});

test('empty context fields use the supported clear endpoint, not an invalid empty PUT', async () => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `fictional.${Buffer.from(JSON.stringify({ scope: ['dp:issues:read', 'dp:orders:read', 'dp:products:read', 'dp:stores:read', 'dp:users:read', 'dp:webhooks:read'], exp: expires })).toString('base64url')}.fictional`;
  const env = { DROPEA_STORES_CONFIG: JSON.stringify([{ store_id: '1', market: 'ES', base_url: 'https://es.public-api.dropea.com',
    jwt_secret_reference: 'FICTIONAL_READ_TOKEN', jwt_expires_at: new Date(expires * 1000).toISOString() }]),
    FICTIONAL_READ_TOKEN: token, CHATBY_TOKEN: 'fictional-not-a-credential', SUPABASE_SERVICE_ROLE_KEY: 'fictional-not-a-credential',
    SUPABASE_URL: 'https://fictional.invalid' };
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ status: 'success', data: {} }), { status: 200 });
  };
  try {
    await liveApi(env).updateField('fictional-thread', { field_name: 'CON-Payload', value: '' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'DELETE');
    assert.equal(new URL(calls[0].url).pathname, '/api/subscriber/clear-user-field-by-name');
    assert.deepEqual(JSON.parse(calls[0].options.body), { user_ns: 'fictional-thread', field_name: 'CON-Payload' });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
