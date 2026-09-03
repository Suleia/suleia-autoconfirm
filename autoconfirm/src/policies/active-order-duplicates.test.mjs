import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectActiveOrderSnapshot,
  findBlockingActivePriorOrder,
  normalizedCustomerPhone,
  orderHasActiveOperationalState,
  ordersShareProduct,
  productIdentityKeys
} from './active-order-duplicates.mjs';

const current = {
  orderId: '200',
  customerPhone: '+34 600 000 001',
  createdAt: '2026-08-21T10:00:00Z',
  status: 'PENDING',
  raw: { line_items: [{ product_id: 31666, variant_id: 31666, sku: 'COLLAGUM', product_name: 'Collagum' }] }
};

function order({
  id,
  status,
  createdAt = '2026-08-18T10:00:00Z',
  phone = '600000001',
  sku = 'COLLAGUM',
  productId = 31666,
  issues = null,
  withProduct = true
}) {
  return {
    orderId: String(id),
    customerPhone: phone,
    createdAt,
    status,
    raw: {
      ...(withProduct ? { line_items: [{ product_id: productId, sku, product_name: sku }] } : {}),
      ...(issues ? { issues } : {})
    }
  };
}

test('normalizes Spanish phones without depending on formatting prefixes', () => {
  assert.equal(normalizedCustomerPhone('+34 600 000 001'), '600000001');
  assert.equal(normalizedCustomerPhone('0034-600000001'), '600000001');
  assert.equal(normalizedCustomerPhone('123'), '');
});

test('extracts stable product identities and matches the same product', () => {
  assert.ok(productIdentityKeys(current).includes('sku:collagum'));
  assert.equal(ordersShareProduct(current, order({ id: 100, status: 'TRANSIT' })), true);
  assert.equal(ordersShareProduct(current, order({ id: 101, status: 'TRANSIT', sku: 'CREMANIDA', productId: 31547 })), false);
  assert.equal(ordersShareProduct(current, order({ id: 102, status: 'TRANSIT', withProduct: false })), null);
});

for (const status of [
  'PENDING', 'CONFIRMED', 'PROCESSING', 'PREPARING', 'PREPARED',
  'SHIPPING', 'TRANSIT', 'IN_TRANSIT', 'INCIDENCE', 'RECLAIM'
]) {
  test(`an older ${status} order with the same product blocks the later order`, () => {
    const result = findBlockingActivePriorOrder(current, [order({ id: 100, status })]);
    assert.equal(result.kind, 'ACTIVE_PRIOR_SAME_PRODUCT_ORDER');
    assert.equal(result.order.orderId, '100');
  });
}

for (const status of ['ERROR', 'REVIEW']) {
  test(`an older ${status} order with the same product is blocked for manual review`, () => {
    const result = findBlockingActivePriorOrder(current, [order({ id: 100, status })]);
    assert.equal(result.kind, 'UNVERIFIABLE');
    assert.equal(result.reason, 'ACTIVE_PRIOR_SAME_PRODUCT_STATUS_REQUIRES_REVIEW');
  });
}

test('an older active order for a different product does not block', () => {
  const result = findBlockingActivePriorOrder(current, [
    order({ id: 100, status: 'TRANSIT', sku: 'CREMANIDA', productId: 31547 })
  ]);
  assert.equal(result, null);
});

test('an open incident blocks the same product even when the top-level status is terminal', () => {
  const prior = order({ id: 100, status: 'FINISH', issues: { id: 9, status: 'PENDING' } });
  assert.equal(orderHasActiveOperationalState(prior), true);
  assert.equal(findBlockingActivePriorOrder(current, [prior]).kind, 'ACTIVE_PRIOR_SAME_PRODUCT_ORDER');
});

for (const status of ['DELIVERED', 'CANCELLED', 'REJECTED', 'RETURNED', 'INDEMNIFIED']) {
  test(`a terminal ${status} order does not block`, () => {
    assert.equal(findBlockingActivePriorOrder(current, [order({ id: 100, status })]), null);
  });
}

test('missing product identity fails closed for manual review and never asserts a duplicate', () => {
  const result = findBlockingActivePriorOrder(current, [
    order({ id: 100, status: 'TRANSIT', withProduct: false })
  ]);
  assert.equal(result.kind, 'UNVERIFIABLE');
  assert.equal(result.reason, 'ACTIVE_ORDER_PRODUCT_IDENTITY_MISSING');
});

test('another phone, the current order and a newer order do not block', () => {
  assert.equal(findBlockingActivePriorOrder(current, [order({ id: 100, status: 'TRANSIT', phone: '600000002' })]), null);
  assert.equal(findBlockingActivePriorOrder(current, [order({ id: 200, status: 'TRANSIT' })]), null);
  assert.equal(findBlockingActivePriorOrder(current, [
    order({ id: 300, status: 'TRANSIT', createdAt: '2026-08-22T10:00:00Z' })
  ]), null);
});

test('ambiguous ordering of the same product fails closed', () => {
  const result = findBlockingActivePriorOrder(
    { ...current, orderId: 'current', createdAt: null },
    [order({ id: 'prior', status: 'TRANSIT', createdAt: null })]
  );
  assert.equal(result.kind, 'UNVERIFIABLE');
  assert.equal(result.reason, 'ACTIVE_SAME_PRODUCT_ORDER_SEQUENCE_AMBIGUOUS');
});

test('complete paginated snapshot includes every governed source and pending incidents', async () => {
  const calls = [];
  const snapshot = await collectActiveOrderSnapshot({
    statuses: ['PENDING', 'SHIPPING'],
    limit: 2,
    maxPagesPerStatus: 3,
    listByStatus: async ({ status, page }) => {
      calls.push(`${status}:${page}`);
      if (status === 'PENDING' && page === 1) return [current, order({ id: 150, status: 'PENDING', phone: '600000009' })];
      if (status === 'PENDING' && page === 2) return [];
      if (status === 'SHIPPING' && page === 1) return [order({ id: 100, status: 'TRANSIT' })];
      return [];
    },
    listPendingIncidents: async () => [{
      order: order({ id: 90, status: 'FINISH' }),
      issue: { id: 77, status: 'PENDING', is_active: true, raw: { market: 'ES' } }
    }]
  });
  assert.deepEqual(calls, ['PENDING:1', 'PENDING:2', 'SHIPPING:1']);
  assert.equal(findBlockingActivePriorOrder(current, snapshot).order.orderId, '100');
  assert.equal(snapshot.find((item) => item.orderId === '90').status, 'INCIDENCE');
});

test('a scan that reaches its page bound fails closed', async () => {
  await assert.rejects(() => collectActiveOrderSnapshot({
    statuses: ['PENDING'],
    limit: 1,
    maxPagesPerStatus: 2,
    listByStatus: async () => [order({ id: 999, status: 'PENDING', phone: '600000009' })]
  }), (error) => error.code === 'ACTIVE_ORDER_SCAN_INCOMPLETE');
});
