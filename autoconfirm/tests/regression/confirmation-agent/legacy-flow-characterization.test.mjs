import './isolated-env.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

const futureExpirySeconds = 4_102_444_800; // 2100-01-01T00:00:00.000Z
const futureExpiryIso = new Date(futureExpirySeconds * 1000).toISOString();

function fixtureJwt(scopes) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ scope: scopes, exp: futureExpirySeconds })).toString('base64url');
  return `${header}.${payload}.fixture-signature`;
}

const readToken = fixtureJwt([
  'dp:issues:read',
  'dp:orders:read',
  'dp:products:read',
  'dp:stores:read',
  'dp:users:read',
  'dp:webhooks:read'
]);
const actionToken = fixtureJwt([
  'dp:orders:read',
  'dp:orders:confirm',
  'dp:orders:cancel'
]);

process.env.CHATBY_TOKEN = 'fixture-chatby-token';
process.env.CHATBY_BASE_URL = 'https://chatby.fixture.invalid/api';
process.env.CHATBY_REQUEST_MIN_INTERVAL_MS = '0';
process.env.CHATBY_SUBSCRIBER_CACHE_MS = '1000';
process.env.DROPEA_READ_JWT_FIXTURE = readToken;
process.env.DROPEA_ACTION_JWT_FIXTURE = actionToken;
process.env.DROPEA_STORES_CONFIG = JSON.stringify([{
  store_id: 'fixture-store',
  market: 'ES',
  base_url: 'https://es.public-api.dropea.com',
  jwt_secret_reference: 'DROPEA_READ_JWT_FIXTURE',
  jwt_expires_at: futureExpiryIso
}]);
process.env.DROPEA_ACTIONS_STORES_CONFIG = JSON.stringify([{
  store_id: 'fixture-store',
  market: 'ES',
  base_url: 'https://es.public-api.dropea.com',
  jwt_secret_reference: 'DROPEA_ACTION_JWT_FIXTURE',
  jwt_expires_at: futureExpiryIso
}]);

const pendingDropeaOrders = [];
const subscribers = [];
const chatMessagesByUser = new Map();
const fetchCalls = [];
let failChatbyMessages = false;

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = String(options.method || 'GET').toUpperCase();
  fetchCalls.push({ method, url: url.toString(), body: options.body || null });

  if (url.hostname === 'chatby.fixture.invalid') {
    if (url.pathname === '/api/subscribers') return response({ data: subscribers });
    if (url.pathname === '/api/subscriber/chat-messages') {
      if (failChatbyMessages) throw new Error('fixture_chatby_unavailable');
      return response({ data: chatMessagesByUser.get(url.searchParams.get('user_ns')) || [] });
    }
    if (url.pathname === '/api/subscriber/send-text') return response({ ok: true, fixture: true });
    throw new Error(`Unexpected Chatby fixture request: ${method} ${url.pathname}`);
  }

  if (url.hostname === 'es.public-api.dropea.com') {
    if (method === 'GET' && url.pathname === '/dropshipper/orders') {
      return response({
        success: true,
        message: 'fixture',
        data: { items: pendingDropeaOrders, pagination: { page: 1, total: pendingDropeaOrders.length } }
      });
    }

    const orderMatch = url.pathname.match(/^\/dropshipper\/orders\/(\d+)$/);
    if (method === 'GET' && orderMatch) {
      const found = pendingDropeaOrders.find((order) => String(order.id) === orderMatch[1]);
      return response({ success: true, message: 'fixture', data: found || fixtureDropeaOrder(orderMatch[1]) });
    }

    const actionMatch = url.pathname.match(/^\/dropshipper\/orders\/(\d+)\/(confirm|cancel)$/);
    if (method === 'POST' && actionMatch) {
      const found = pendingDropeaOrders.find((order) => String(order.id) === actionMatch[1]);
      if (found) {
        found.status = actionMatch[2] === 'cancel' ? 'FINISH' : 'CONFIRMED';
        found.sub_status = actionMatch[2] === 'cancel' ? 'CANCELLED' : null;
      }
      return response({
        success: true,
        data: {
          id: Number(actionMatch[1]),
          status: actionMatch[2] === 'cancel' ? 'FINISH' : 'CONFIRMED',
          sub_status: actionMatch[2] === 'cancel' ? 'CANCELLED' : null,
          fixture: true
        }
      });
    }
    throw new Error(`Unexpected Dropea fixture request: ${method} ${url.pathname}`);
  }

  throw new Error(`Network blocked by regression fixture: ${method} ${url.toString()}`);
};

const {
  analyzeAndMaybeConfirmOrder,
  customerConversationIntentForOrder,
  handleShopifyWebhook
} = await import('../../../src/workflows/orders.mjs');
const { runUnansweredCancellationSweep } = await import('../../../src/workflows/unanswered-cancellations.mjs');
const { invalidateSubscriberIndexCache } = await import('../../../src/clients/chatby.mjs');
const { findOrder, saveOrders, saveState } = await import('../../../src/storage.mjs');

const baseStore = Object.freeze({
  id: 'suleia',
  agentEnabled: true,
  agentDryRun: false,
  delayedConfirmRealEnabled: false,
  confirmationDelayHours: 1,
  unansweredCancelAfterHours: 48,
  unansweredRejectRealEnabled: true,
  confidenceThreshold: 90,
  cooldownHours: 1,
  blockedCustomerPhones: []
});

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 36e5).toISOString();
}

function fixtureOrder(id, overrides = {}) {
  const createdAt = overrides.createdAt || isoHoursAgo(4);
  return {
    orderId: String(id),
    status: 'PENDING',
    customerName: 'Cliente Fixture',
    customerPhone: '+34600000000',
    createdAt,
    raw: { created_at: createdAt },
    chatbyUserNs: `fixture-user-${id}`,
    ...overrides
  };
}

function fixtureDropeaOrder(id, overrides = {}) {
  const createdAt = overrides.created_at || isoHoursAgo(72);
  return {
    id: Number(id),
    status: 'PENDING',
    sub_status: null,
    total_amount: 29.99,
    currency: 'EUR',
    created_at: createdAt,
    shipping_address: {
      full_name: 'Cliente Fixture',
      phone_number: '+34600000000',
      email: 'fixture@example.invalid'
    },
    line_items: [],
    ...overrides
  };
}

function inbound(content, createdAt) {
  return { role: 'customer', direction: 'inbound', content, created_at: createdAt };
}

function exactSubscriber(orderId, overrides = {}) {
  return {
    user_ns: `fixture-user-${orderId}`,
    phone: '+34600000000',
    lead_status: 'NUEVO',
    tags: [{ name: 'PED-Nuevo' }],
    labels: [],
    user_fields: [{ name: 'Dropea: Numero', value: String(orderId) }],
    ...overrides
  };
}

function resetFixtures() {
  pendingDropeaOrders.splice(0);
  subscribers.splice(0);
  chatMessagesByUser.clear();
  fetchCalls.splice(0);
  failChatbyMessages = false;
  invalidateSubscriberIndexCache();
  saveOrders([]);
  saveState({});
}

function dropeaActionCalls(action = null) {
  return fetchCalls.filter((call) => call.method === 'POST'
    && /\/dropshipper\/orders\/\d+\/(confirm|cancel)$/.test(new URL(call.url).pathname)
    && (!action || new URL(call.url).pathname.endsWith(`/${action}`)));
}

test.beforeEach(resetFixtures);

test('confirmation is persisted with a one-hour due time and Chatby is re-read before a later cancellation', async () => {
  const confirmationAt = isoHoursAgo(0.25);
  const order = fixtureOrder('2001');
  subscribers.push(exactSubscriber(order.orderId));
  chatMessagesByUser.set(order.chatbyUserNs, [inbound('Sí, lo quiero', confirmationAt)]);

  const scheduled = await analyzeAndMaybeConfirmOrder(order, baseStore);
  assert.equal(scheduled.action, 'confirmation_scheduled');
  assert.equal(scheduled.dueAt, new Date(new Date(confirmationAt).getTime() + 36e5).toISOString());

  const persisted = findOrder(baseStore.id, order.orderId);
  assert.equal(persisted.aiIntent, 'CONFIRM_DELAY_PENDING');
  assert.equal(persisted.confirmationDelayStartedAt, confirmationAt);
  assert.equal(persisted.confirmationDueAt, scheduled.dueAt);

  chatMessagesByUser.set(order.chatbyUserNs, [
    inbound('Sí, lo quiero', confirmationAt),
    inbound('Me he arrepentido, no lo quiero', isoHoursAgo(0.1))
  ]);
  invalidateSubscriberIndexCache();

  const reconsidered = await analyzeAndMaybeConfirmOrder(persisted, baseStore);
  assert.equal(reconsidered.action, 'rejected_after_confirmation_cancel');
  assert.equal(reconsidered.analysis.intent, 'CANCEL');
  assert.equal(dropeaActionCalls('cancel').length, 1);
  assert.ok(fetchCalls.filter((call) => new URL(call.url).pathname === '/api/subscriber/chat-messages').length >= 2);
});

test('a mature delayed confirmation is re-read and becomes a simulation result when real delayed confirmation is disabled', async () => {
  const startedAt = isoHoursAgo(2);
  const order = fixtureOrder('2002', {
    aiIntent: 'CONFIRM_DELAY_PENDING',
    aiConfidence: 100,
    confirmationDelayStartedAt: startedAt,
    confirmationDueAt: isoHoursAgo(1),
    confirmationSource: 'customer_text'
  });
  subscribers.push(exactSubscriber(order.orderId));
  chatMessagesByUser.set(order.chatbyUserNs, [inbound('Sí, lo quiero', startedAt)]);

  const result = await analyzeAndMaybeConfirmOrder(order, baseStore);
  assert.equal(result.action, 'would_confirm_after_delay');
  assert.equal(result.dryRun, true);
  assert.equal(result.source, 'customer_text');
  assert.equal(dropeaActionCalls().length, 0);
  assert.equal(fetchCalls.filter((call) => new URL(call.url).pathname === '/api/subscriber/chat-messages').length, 1);
});

test('a mature delayed confirmation uses the official confirm adapter only after the Chatby re-read', async () => {
  const startedAt = isoHoursAgo(2);
  const order = fixtureOrder('2007', {
    aiIntent: 'CONFIRM_DELAY_PENDING',
    aiConfidence: 100,
    confirmationDelayStartedAt: startedAt,
    confirmationDueAt: isoHoursAgo(1),
    confirmationSource: 'chatby_button'
  });
  pendingDropeaOrders.push(fixtureDropeaOrder(order.orderId));
  subscribers.push(exactSubscriber(order.orderId));
  chatMessagesByUser.set(order.chatbyUserNs, [inbound('Sí, lo quiero', startedAt)]);

  const result = await analyzeAndMaybeConfirmOrder(order, {
    ...baseStore,
    delayedConfirmRealEnabled: true
  });
  const readIndex = fetchCalls.findIndex((call) => new URL(call.url).pathname === '/api/subscriber/chat-messages');
  const confirmIndex = fetchCalls.findIndex((call) => new URL(call.url).pathname.endsWith('/confirm'));

  assert.equal(result.action, 'confirmed_after_delay');
  assert.equal(result.dryRun, false);
  assert.equal(dropeaActionCalls('confirm').length, 1);
  assert.ok(readIndex >= 0 && confirmIndex > readIndex);
  assert.equal(findOrder(baseStore.id, order.orderId).status, 'CONFIRMED');
});

test('an address change after confirmation holds the order even when its delay has matured', async () => {
  const startedAt = isoHoursAgo(2);
  const order = fixtureOrder('2003', {
    aiIntent: 'CONFIRM_DELAY_PENDING',
    aiConfidence: 100,
    confirmationDelayStartedAt: startedAt,
    confirmationDueAt: isoHoursAgo(1)
  });
  subscribers.push(exactSubscriber(order.orderId));
  chatMessagesByUser.set(order.chatbyUserNs, [
    inbound('Sí, lo quiero', startedAt),
    inbound('Quiero cambiar la dirección', isoHoursAgo(0.5))
  ]);

  const result = await analyzeAndMaybeConfirmOrder(order, baseStore);
  assert.equal(result.action, 'hold_after_confirmation_address_change');
  assert.equal(result.analysis.intent, 'ADDRESS_CHANGE');
  assert.equal(findOrder(baseStore.id, order.orderId).status, 'PENDING_ADDRESS_CHANGE');
  assert.equal(dropeaActionCalls().length, 0);
});

test('a promotion change after confirmation cancels Dropea and sends the existing exact Chatby text', async () => {
  const startedAt = isoHoursAgo(2);
  const order = fixtureOrder('2008', {
    customerName: 'Ana Fixture',
    aiIntent: 'CONFIRM_DELAY_PENDING',
    aiConfidence: 100,
    confirmationDelayStartedAt: startedAt,
    confirmationDueAt: isoHoursAgo(1),
    raw: {
      created_at: isoHoursAgo(4),
      products: [{ title: 'Colla Gum Fixture' }]
    }
  });
  pendingDropeaOrders.push(fixtureDropeaOrder(order.orderId));
  subscribers.push(exactSubscriber(order.orderId));
  // Characterize the Chatby-button path: the confirmation is persisted on the
  // order, while the later promotion request is the only inbound text.
  chatMessagesByUser.set(order.chatbyUserNs, [
    inbound('Me he equivocado de oferta', isoHoursAgo(0.5))
  ]);

  const result = await analyzeAndMaybeConfirmOrder(order, baseStore);
  const send = fetchCalls.find((call) => new URL(call.url).pathname === '/api/subscriber/send-text');
  const sentBody = JSON.parse(send.body);

  assert.equal(result.action, 'rejected_promotion_change');
  assert.equal(result.analysis.intent, 'PROMOTION_CHANGE');
  assert.equal(dropeaActionCalls('cancel').length, 1);
  assert.equal(sentBody.user_ns, order.chatbyUserNs);
  assert.equal(
    sentBody.content,
    'Hola Ana, hemos cancelado este pedido para que puedas elegir la oferta correcta. Realiza de nuevo la compra desde este enlace: https://suleia.com/products/polvo-dental-de-colageno-colla-gum'
  );
  assert.equal(result.chatbyReplyError, null);
});

test('a repeated confirmation before maturity does not restart the stored timer', async () => {
  const startedAt = isoHoursAgo(0.5);
  const dueAt = new Date(new Date(startedAt).getTime() + 36e5).toISOString();
  const order = fixtureOrder('2009', {
    aiIntent: 'CONFIRM_DELAY_PENDING',
    aiConfidence: 100,
    confirmationDelayStartedAt: startedAt,
    confirmationDueAt: dueAt,
    confirmationSource: 'customer_text'
  });
  saveOrders([{ ...order, storeId: baseStore.id }]);
  subscribers.push(exactSubscriber(order.orderId));
  chatMessagesByUser.set(order.chatbyUserNs, [
    inbound('Sí, lo quiero', startedAt),
    inbound('Confirmo otra vez', isoHoursAgo(0.1))
  ]);

  const result = await analyzeAndMaybeConfirmOrder(order, baseStore);
  const persisted = findOrder(baseStore.id, order.orderId);

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'confirmation_delay_waiting');
  assert.equal(result.dueAt, dueAt);
  assert.equal(persisted.confirmationDelayStartedAt, startedAt);
  assert.equal(persisted.confirmationDueAt, dueAt);
  assert.equal(dropeaActionCalls().length, 0);
});

test('the complete-address shortcut currently outranks a later cancellation in the same conversation', () => {
  const order = fixtureOrder('2004');
  const result = customerConversationIntentForOrder([
    inbound('Quiero cambiar la dirección', isoHoursAgo(2)),
    inbound('Calle Mayor 25, 28013 Madrid', isoHoursAgo(1.5)),
    inbound('Finalmente no lo quiero', isoHoursAgo(1))
  ], order);

  assert.equal(result.intent, 'CONFIRM');
  assert.equal(result.source, 'customer_address_change_with_complete_address');
  assert.match(result.customer_message, /Finalmente no lo quiero/);
});

test('Shopify webhook mapping stays local and a paid Shopify confirmation never calls Dropea', async () => {
  const webhook = await handleShopifyWebhook({
    store: baseStore,
    payload: {
      id: 999,
      name: '#1996',
      created_at: isoHoursAgo(1),
      financial_status: 'pending',
      fulfillment_status: null,
      total_price: '29.99',
      currency: 'EUR',
      customer: { first_name: 'Persona', last_name: 'Fixture', email: 'fixture@example.invalid' },
      shipping_address: { phone: '+34600000000' },
      line_items: [{ title: 'Producto Fixture', quantity: 2 }]
    }
  });
  assert.equal(webhook.accepted, true);
  assert.equal(webhook.order.orderId, 'SHOPIFY-1996');
  assert.equal(webhook.order.customerName, 'Persona Fixture');
  assert.equal(webhook.order.orderAmount, 29.99);
  // The current storage projection does not retain the normalized productName
  // field, although the original Shopify product remains present under raw.
  assert.equal(webhook.order.productName, undefined);
  assert.equal(webhook.order.raw.products[0].title, 'Producto Fixture');
  assert.equal(fetchCalls.length, 0);

  const paidOrder = fixtureOrder('SHOPIFY-2005', {
    raw: { source: 'shopify', financialStatus: 'PAID' }
  });
  subscribers.push(exactSubscriber(paidOrder.orderId));
  chatMessagesByUser.set(paidOrder.chatbyUserNs, [inbound('Sí, lo quiero', isoHoursAgo(0.5))]);
  const confirmed = await analyzeAndMaybeConfirmOrder(paidOrder, { ...baseStore, delayedConfirmRealEnabled: true });
  assert.equal(confirmed.action, 'confirmed_shopify_local');
  assert.equal(confirmed.order.status, 'CONFIRMED');
  assert.equal(dropeaActionCalls().length, 0);
});

test('an unpaid Shopify confirmation remains in manual review and never calls Dropea', async () => {
  const order = fixtureOrder('SHOPIFY-2010', {
    raw: { source: 'shopify', financialStatus: 'PENDING' }
  });
  subscribers.push(exactSubscriber(order.orderId));
  chatMessagesByUser.set(order.chatbyUserNs, [inbound('Sí, lo quiero', isoHoursAgo(0.5))]);

  const result = await analyzeAndMaybeConfirmOrder(order, {
    ...baseStore,
    delayedConfirmRealEnabled: true
  });

  assert.equal(result.action, 'manual_review_non_paid');
  assert.equal(result.financialStatus, 'pending');
  assert.equal(findOrder(baseStore.id, order.orderId).status, 'MANUAL_REVIEW');
  assert.equal(dropeaActionCalls().length, 0);
});

test('an order with no usable subscriber is skipped without any external action', async () => {
  const order = fixtureOrder('2011', { chatbyUserNs: null });
  const result = await analyzeAndMaybeConfirmOrder(order, baseStore);

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_chat_thread');
  assert.equal(dropeaActionCalls().length, 0);
  assert.equal(fetchCalls.some((call) => call.method !== 'GET'), false);
});

test('the unanswered sweep keeps its current mode truth table', async () => {
  const cases = [
    { id: '3001', agentDryRun: true, enabled: true, action: 'cancelled_unanswered', writes: 1 },
    { id: '3002', agentDryRun: false, enabled: false, action: 'cancelled_unanswered', writes: 1 },
    { id: '3003', agentDryRun: true, enabled: false, action: 'would_cancel_unanswered', writes: 0 }
  ];

  for (const fixture of cases) {
    resetFixtures();
    pendingDropeaOrders.push(fixtureDropeaOrder(fixture.id));
    const result = await runUnansweredCancellationSweep({
      store: {
        ...baseStore,
        agentDryRun: fixture.agentDryRun,
        unansweredRejectRealEnabled: fixture.enabled
      },
      limit: 100,
      pages: 1
    });
    assert.equal(result.results[0].action, fixture.action, JSON.stringify(fixture));
    assert.equal(dropeaActionCalls('cancel').length, fixture.writes, JSON.stringify(fixture));
  }
});

test('a blocked phone is cancelled before age, Chatby and dry-run checks', async () => {
  pendingDropeaOrders.push(fixtureDropeaOrder('3004', {
    created_at: new Date().toISOString(),
    shipping_address: {
      full_name: 'Cliente Bloqueado Fixture',
      phone_number: '+34999999999',
      email: 'blocked@example.invalid'
    }
  }));

  const result = await runUnansweredCancellationSweep({
    store: {
      ...baseStore,
      agentDryRun: true,
      unansweredRejectRealEnabled: false,
      blockedCustomerPhones: ['999999999']
    },
    limit: 100,
    pages: 1
  });
  assert.equal(result.results[0].action, 'cancelled_blocked_customer');
  assert.equal(result.results[0].dryRun, false);
  assert.equal(dropeaActionCalls('cancel').length, 1);
  assert.equal(fetchCalls.some((call) => new URL(call.url).hostname === 'chatby.fixture.invalid'), false);
});

test('stored confirmation alone does not veto the current unanswered cancellation decision', async () => {
  const orderId = '3005';
  pendingDropeaOrders.push(fixtureDropeaOrder(orderId));
  saveOrders([fixtureOrder(orderId, {
    aiIntent: 'CONFIRM',
    aiConfidence: 100,
    status: 'CONFIRMED_BY_CUSTOMER'
  })]);

  const result = await runUnansweredCancellationSweep({
    store: { ...baseStore, agentDryRun: true, unansweredRejectRealEnabled: false },
    limit: 100,
    pages: 1
  });
  assert.equal(result.results[0].action, 'would_cancel_unanswered');
  assert.equal(dropeaActionCalls().length, 0);
});

test('a Chatby read error fails closed and suppresses cancellation', async () => {
  const orderId = '3006';
  pendingDropeaOrders.push(fixtureDropeaOrder(orderId));
  subscribers.push(exactSubscriber(orderId));
  failChatbyMessages = true;

  const result = await runUnansweredCancellationSweep({
    store: { ...baseStore, agentDryRun: false, unansweredRejectRealEnabled: true },
    limit: 100,
    pages: 1
  });
  assert.equal(result.results[0].reason, 'chatby_check_failed_fail_closed');
  assert.equal(result.results[0].skipped, true);
  assert.equal(dropeaActionCalls().length, 0);
});
