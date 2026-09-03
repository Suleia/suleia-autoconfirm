import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'suleia-active-duplicate-'));
process.env.ORDERS_PATH = path.join(temp, 'orders.json');
process.env.STATE_PATH = path.join(temp, 'state.json');
process.env.WEBHOOK_EVENTS_PATH = path.join(temp, 'webhook-events.json');
process.env.STORE_CONFIG_PATH = path.join(temp, 'stores.json');
process.env.SUPABASE_ENABLED = 'false';
delete process.env.GOOGLE_SHEET_ID;
delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
delete process.env.GOOGLE_PRIVATE_KEY;

const { activeDuplicateOrderPolicy } = await import('./orders.mjs');

after(() => fs.rmSync(temp, { recursive: true, force: true }));

const store = { id: 'suleia' };

function fixtureOrder({
  id,
  status = 'PENDING',
  createdAt,
  phone = '+34 600 000 000',
  sku = 'COLLAGUM',
  productId = 31666
}) {
  return {
    orderId: String(id),
    storeId: 'suleia',
    status,
    createdAt,
    customerPhone: phone,
    raw: {
      created_at: createdAt,
      line_items: [{ sku, product_id: productId, product_name: sku }]
    }
  };
}

test('cancels only the later pending order after a fresh same-phone and same-product check', async () => {
  const current = fixtureOrder({ id: 200, createdAt: '2026-09-03T12:00:00Z' });
  const prior = fixtureOrder({ id: 100, status: 'TRANSIT', createdAt: '2026-09-01T12:00:00Z' });
  const cancelled = [];
  let currentReads = 0;
  const result = await activeDuplicateOrderPolicy(current, store, 'fixture', {
    loadSnapshot: async () => [current, prior],
    getOrderById: async (id) => {
      if (String(id) === '100') return prior;
      currentReads += 1;
      return currentReads === 1 ? current : { ...current, status: 'CANCELLED' };
    },
    cancelOrder: async (id) => {
      cancelled.push(String(id));
      return { order_id: Number(id), status: 'cancelled' };
    }
  });

  assert.deepEqual(cancelled, ['200']);
  assert.equal(result.action, 'cancelled_active_duplicate');
  assert.equal(result.blockingOrderId, '100');
  assert.equal(result.order.status, 'CANCELLED_ACTIVE_DUPLICATE');
  assert.equal(result.order.chatbyTemplateSendStatus, 'blocked_active_duplicate_cancelled');
});

test('does not cancel when the active prior order contains a different product', async () => {
  const current = fixtureOrder({ id: 200, createdAt: '2026-09-03T12:00:00Z' });
  const prior = fixtureOrder({
    id: 100,
    status: 'TRANSIT',
    createdAt: '2026-09-01T12:00:00Z',
    sku: 'CREMANIDA',
    productId: 31547
  });
  let cancelled = false;
  const result = await activeDuplicateOrderPolicy(current, store, 'fixture', {
    loadSnapshot: async () => [current, prior],
    getOrderById: async () => { throw new Error('must not read'); },
    cancelOrder: async () => { cancelled = true; }
  });

  assert.equal(result, null);
  assert.equal(cancelled, false);
});

test('does not cancel when the prior order became terminal during the final read', async () => {
  const current = fixtureOrder({ id: 200, createdAt: '2026-09-03T12:00:00Z' });
  const prior = fixtureOrder({ id: 100, status: 'TRANSIT', createdAt: '2026-09-01T12:00:00Z' });
  let cancelled = false;
  const result = await activeDuplicateOrderPolicy(current, store, 'fixture', {
    loadSnapshot: async () => [current, prior],
    getOrderById: async (id) => String(id) === '100' ? { ...prior, status: 'DELIVERED' } : current,
    cancelOrder: async () => { cancelled = true; }
  });

  assert.equal(cancelled, false);
  assert.equal(result.action, 'active_duplicate_freshness_blocked');
});

test('rechecks an accepted cancellation until Dropea reports a terminal status', async () => {
  const current = fixtureOrder({ id: 200, createdAt: '2026-09-03T12:00:00Z' });
  current.aiIntent = 'ACTIVE_DUPLICATE_CANCELLATION_REQUESTED';
  const prior = fixtureOrder({ id: 100, status: 'TRANSIT', createdAt: '2026-09-01T12:00:00Z' });
  let currentReads = 0;
  let cancelCalls = 0;
  const result = await activeDuplicateOrderPolicy(current, store, 'fixture', {
    loadSnapshot: async () => [current, prior],
    getOrderById: async (id) => {
      if (String(id) === '100') return prior;
      currentReads += 1;
      return currentReads === 1 ? current : { ...current, status: 'CANCELLED' };
    },
    cancelOrder: async () => {
      cancelCalls += 1;
      return { status: 'accepted' };
    }
  });

  assert.equal(cancelCalls, 1);
  assert.equal(result.action, 'cancelled_active_duplicate');
});

test('all template and confirmation paths invoke the active duplicate policy first', () => {
  const source = fs.readFileSync(new URL('./orders.mjs', import.meta.url), 'utf8');
  for (const marker of [
    'dropea_pending_ingest',
    'initial_template_backfill_guard',
    'chatby_template_send_guard',
    'stored_confirmation_guard',
    'delayed_confirmation_guard',
    'customer_message_confirmation_guard',
    'chatby_button_confirmation_guard',
    'classified_confirmation_guard'
  ]) {
    assert.match(source, new RegExp(`activeDuplicateOrderPolicy\\([^;]+['\"]${marker}['\"]`));
  }
  const sendFunction = source.slice(
    source.indexOf('async function sendChatbyTemplateForOrder'),
    source.indexOf('\nexport async function', source.indexOf('async function sendChatbyTemplateForOrder'))
  );
  assert.ok(sendFunction.indexOf("activeDuplicateOrderPolicy(order, store, 'chatby_template_send_guard')")
    < sendFunction.indexOf('sendInitialTemplateWithFallback({'));
  assert.match(source, /exactOrderThread = sameOrderId\(currentSubscriberOrderId\(subscriber\), order\.orderId\)/);
  assert.ok(source.indexOf('if (!exactOrderThread) continue;')
    < source.indexOf('const alreadyDelivered = messages.some'));
});
