import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectIncidentDiscountOrderPair,
  selectShopifyOrderForDropeaOrder,
  selectRecentShopifyOnlyTestOrder
} from './incident-discount-order-match.mjs';

test('matches the newest Shopify order to the closest Dropea order for a returning customer', () => {
  const pair = selectIncidentDiscountOrderPair({
    shopifyOrders: [
      { id: 'shop-old', createdAt: '2026-06-01T10:00:00.000Z' },
      { id: 'shop-new', createdAt: '2026-07-28T18:00:00.000Z' }
    ],
    dropeaOrders: [
      { orderId: 'drop-old', createdAt: '2026-06-01T10:01:00.000Z' },
      { orderId: 'drop-new', createdAt: '2026-07-28T18:03:00.000Z' }
    ]
  });

  assert.equal(pair.shopifyOrder.id, 'shop-new');
  assert.equal(pair.dropeaOrder.orderId, 'drop-new');
  assert.equal(pair.differenceMs, 3 * 60 * 1000);
});

test('fails closed when no Dropea order is close enough to the newest Shopify order', () => {
  const pair = selectIncidentDiscountOrderPair({
    shopifyOrders: [{ id: 'shop-new', createdAt: '2026-07-28T18:00:00.000Z' }],
    dropeaOrders: [{ orderId: 'drop-old', createdAt: '2026-07-20T18:00:00.000Z' }]
  });

  assert.equal(pair, null);
});

test('fails closed when either source has no trustworthy creation timestamp', () => {
  assert.equal(selectIncidentDiscountOrderPair({
    shopifyOrders: [{ id: 'shop', createdAt: '' }],
    dropeaOrders: [{ orderId: 'drop', createdAt: '2026-07-28T18:00:00.000Z' }]
  }), null);
});

test('matches the exact Dropea incident order instead of a newer order from the same phone', () => {
  const selected = selectShopifyOrderForDropeaOrder({
    dropeaOrder: {
      orderId: 'drop-incident',
      createdAt: '2026-08-18T10:00:00.000Z',
      raw: { external_order_id: '#2007' }
    },
    shopifyOrders: [
      { id: 'gid://shopify/Order/new', name: '#2028', createdAt: '2026-08-21T10:00:00.000Z' },
      { id: 'gid://shopify/Order/incident', name: '#2007', createdAt: '2026-08-18T10:01:00.000Z' }
    ]
  });
  assert.equal(selected.order.name, '#2007');
  assert.equal(selected.exactReference, true);
});

test('fails closed when the incident order cannot be correlated to Shopify', () => {
  assert.equal(selectShopifyOrderForDropeaOrder({
    dropeaOrder: { createdAt: '2026-08-18T10:00:00.000Z' },
    shopifyOrders: [{ name: '#9999', createdAt: '2026-08-25T10:00:00.000Z' }]
  }), null);
});

test('allows only a recent Shopify order in the explicitly isolated test lane', () => {
  const selected = selectRecentShopifyOnlyTestOrder([
    { id: 'shop-old', createdAt: '2026-07-20T18:00:00.000Z' },
    { id: 'shop-new', createdAt: '2026-07-28T18:49:41.000Z' }
  ], { now: Date.parse('2026-07-28T22:00:00.000Z') });

  assert.equal(selected.order.id, 'shop-new');
  assert.equal(selected.ageMs, 11_419_000);
});

test('rejects an old or future Shopify order in the isolated test lane', () => {
  assert.equal(selectRecentShopifyOnlyTestOrder([
    { id: 'old', createdAt: '2026-07-20T18:00:00.000Z' }
  ], { now: Date.parse('2026-07-28T22:00:00.000Z') }), null);
  assert.equal(selectRecentShopifyOnlyTestOrder([
    { id: 'future', createdAt: '2026-07-29T01:01:00.000Z' }
  ], { now: Date.parse('2026-07-28T22:00:00.000Z') }), null);
});
