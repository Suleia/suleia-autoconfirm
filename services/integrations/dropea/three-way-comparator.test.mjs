import test from 'node:test';
import assert from 'node:assert/strict';
import { compareThreeWay, THREE_WAY_COMPARISON_STATUSES } from './three-way-comparator.mjs';

const NOW = new Date('2026-08-04T12:00:00Z');
const base = Object.freeze({
  market: 'ES', store_id: '17', dropea_order_id: '42', status: 'SHIPPING', sub_status: 'SHIPPED',
  total_amount: 29.9, product_key: 'PRODUCT:8', created_at: '2026-08-04T10:00:00Z',
  updated_at: '2026-08-04T11:59:00Z', active_issue: false
});

test('three-way comparator matches equal records and exposes the closed status vocabulary', () => {
  assert.equal(compareThreeWay({ dropea: base, currentSystem: base, mirror: base, now: NOW }).status, 'MATCH');
  assert.equal(THREE_WAY_COMPARISON_STATUSES.length, 10);
});

test('three-way comparator blocks missing, duplicate, stale and incomplete data', () => {
  assert.equal(compareThreeWay({ dropea: base, currentSystem: base, mirror: null, now: NOW }).status, 'MISSING_RECORD');
  assert.equal(compareThreeWay({ dropea: base, currentSystem: { ...base, store_id: '99' }, mirror: base, now: NOW }).status, 'DUPLICATE_IDENTITY');
  assert.equal(compareThreeWay({ dropea: base, currentSystem: base, mirror: { ...base, updated_at: '2026-08-04T10:00:00Z' }, now: NOW }).status, 'STALE');
  assert.equal(compareThreeWay({ dropea: base, currentSystem: base, mirror: base, paginationComplete: false, now: NOW }).status, 'PAGINATION_INCOMPLETE');
});
