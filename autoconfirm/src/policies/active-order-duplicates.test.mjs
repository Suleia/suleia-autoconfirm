import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  findBlockingActivePriorOrder,
  normalizedCustomerPhone,
  orderHasActiveOperationalState,
  scanForBlockingActivePriorOrder
} from './active-order-duplicates.mjs';

const current = {
  orderId: '200',
  customerPhone: '+34 600 000 001',
  createdAt: '2026-08-21T10:00:00Z',
  status: 'PENDING'
};

function order({ id, status, createdAt = '2026-08-18T10:00:00Z', phone = '600000001', issues = null }) {
  return {
    orderId: String(id),
    customerPhone: phone,
    createdAt,
    status,
    raw: issues ? { issues } : {}
  };
}

test('normalizes Spanish phones without storing or comparing formatting prefixes', () => {
  assert.equal(normalizedCustomerPhone('+34 600 000 001'), '600000001');
  assert.equal(normalizedCustomerPhone('0034-600000001'), '600000001');
  assert.equal(normalizedCustomerPhone('123'), '');
});

for (const status of [
  'PENDING', 'CONFIRMED', 'PROCESSING', 'PREPARING', 'PREPARED',
  'SHIPPING', 'TRANSIT', 'IN_TRANSIT', 'ERROR', 'REVIEW', 'INCIDENCE', 'RECLAIM'
]) {
  test(`an older ${status} order blocks the later order`, () => {
    const result = findBlockingActivePriorOrder(current, [order({ id: 100, status })]);
    assert.equal(result.kind, 'ACTIVE_PRIOR_ORDER');
    assert.equal(result.order.orderId, '100');
  });
}

test('an open incident blocks even when the top-level status is not an active enum', () => {
  const prior = order({ id: 100, status: 'FINISH', issues: { id: 9, status: 'PENDING' } });
  assert.equal(orderHasActiveOperationalState(prior), true);
  assert.equal(findBlockingActivePriorOrder(current, [prior]).kind, 'ACTIVE_PRIOR_ORDER');
});

for (const status of ['DELIVERED', 'CANCELLED', 'REJECTED', 'RETURNED', 'INDEMNIFIED']) {
  test(`a terminal ${status} order does not block`, () => {
    assert.equal(findBlockingActivePriorOrder(current, [order({ id: 100, status })]), null);
  });
}

test('a closed historical incident does not block', () => {
  const prior = order({ id: 100, status: 'DELIVERED', issues: { id: 9, status: 'RESOLVED' } });
  assert.equal(orderHasActiveOperationalState(prior), false);
  assert.equal(findBlockingActivePriorOrder(current, [prior]), null);
});

test('another phone, the current order itself, and a newer order do not block', () => {
  assert.equal(findBlockingActivePriorOrder(current, [order({ id: 100, status: 'TRANSIT', phone: '600000002' })]), null);
  assert.equal(findBlockingActivePriorOrder(current, [order({ id: 200, status: 'TRANSIT' })]), null);
  assert.equal(findBlockingActivePriorOrder(current, [
    order({ id: 300, status: 'TRANSIT', createdAt: '2026-08-22T10:00:00Z' })
  ]), null);
});

test('missing or ambiguous ordering fails closed instead of assuming no duplicate', () => {
  assert.equal(findBlockingActivePriorOrder({ ...current, customerPhone: '' }, []).kind, 'UNVERIFIABLE');
  const result = findBlockingActivePriorOrder(
    { ...current, orderId: 'SHOPIFY-current', createdAt: null },
    [order({ id: 'external-prior', status: 'TRANSIT', createdAt: null })]
  );
  assert.equal(result.kind, 'UNVERIFIABLE');
  assert.equal(result.reason, 'ACTIVE_ORDER_SEQUENCE_AMBIGUOUS');
});

test('complete paginated scan checks every governed source status and returns the prior active order', async () => {
  const calls = [];
  const result = await scanForBlockingActivePriorOrder({
    currentOrder: current,
    statuses: ['PENDING', 'SHIPPING'],
    limit: 2,
    maxPagesPerStatus: 3,
    listByStatus: async ({ status, page }) => {
      calls.push(`${status}:${page}`);
      if (status === 'PENDING' && page === 1) {
        return [current, order({ id: 150, status: 'PENDING', phone: '600000009' })];
      }
      if (status === 'PENDING' && page === 2) return [];
      if (status === 'SHIPPING' && page === 1) return [order({ id: 100, status: 'TRANSIT' })];
      return [];
    }
  });
  assert.deepEqual(calls, ['PENDING:1', 'PENDING:2', 'SHIPPING:1']);
  assert.equal(result.kind, 'ACTIVE_PRIOR_ORDER');
  assert.equal(result.order.orderId, '100');
});

test('the authoritative pending-incidence feed blocks an older incident order independently of top-level status', async () => {
  const result = await scanForBlockingActivePriorOrder({
    currentOrder: current,
    statuses: [],
    listByStatus: async () => [],
    listPendingIncidents: async () => [{
      order: order({ id: 100, status: 'FINISH' }),
      issue: { id: 77, status: 'PENDING', is_active: true, raw: { market: 'ES' } }
    }]
  });
  assert.equal(result.kind, 'ACTIVE_PRIOR_ORDER');
  assert.equal(result.order.status, 'INCIDENCE');
  assert.equal(result.order.orderId, '100');
});

test('an unavailable pending-incidence feed fails closed', async () => {
  await assert.rejects(() => scanForBlockingActivePriorOrder({
    currentOrder: current,
    statuses: [],
    listByStatus: async () => [],
    listPendingIncidents: async () => { throw new Error('fixture outage'); }
  }), /fixture outage/);
});

test('a scan that reaches its page bound fails closed', async () => {
  await assert.rejects(() => scanForBlockingActivePriorOrder({
    currentOrder: current,
    statuses: ['PENDING'],
    limit: 1,
    maxPagesPerStatus: 2,
    listByStatus: async () => [order({ id: 999, status: 'PENDING', phone: '600000009' })]
  }), (error) => error.code === 'ACTIVE_ORDER_SCAN_INCOMPLETE');
});

test('every confirmation route is guarded and delayed cancellation remains ahead of the guard', () => {
  const source = fs.readFileSync(new URL('../workflows/orders.mjs', import.meta.url), 'utf8');
  for (const marker of [
    'stored_confirmation_guard',
    'customer_message_confirmation_guard',
    'chatby_button_confirmation_guard',
    'classified_confirmation_guard',
    'delayed_confirmation_guard'
  ]) {
    assert.match(source, new RegExp(`activePriorOrderConfirmationGuard\\(order, store, '${marker}'\\)`));
  }
  const delayedStart = source.indexOf('async function processDelayedConfirmation');
  const delayedEnd = source.indexOf('async function simulationOverrideResult', delayedStart);
  const delayed = source.slice(delayedStart, delayedEnd);
  const guard = delayed.indexOf("activePriorOrderConfirmationGuard(order, store, 'delayed_confirmation_guard')");
  assert.ok(delayed.indexOf('cancelDropeaOrder(order.orderId)') < guard, 'customer cancellation must remain ahead of duplicate hold');
  assert.ok(guard < delayed.indexOf('confirmDropeaOrder(order.orderId)'), 'duplicate hold must precede real confirmation');
});
