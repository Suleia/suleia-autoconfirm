import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOperationalSources } from '../src/operational-truth/reconciliation-worker.mjs';

const AT = '2026-08-01T12:00:00.000Z';
const complete = {
  dropea_webhook: { status: 'PENDING' }, dropea_get: { status: 'PENDING' },
  chatby_webhook: { intent: 'UNKNOWN' }, chatby_get: { intent: 'UNKNOWN' },
  event_store: { status: 'PENDING' }, digital_twin: { status: 'PENDING' },
  legacy_system: { decision: 'WAIT' }, decision_memory: { decision: 'WAIT' },
  timers: { status: 'ACTIVE' }
};

test('reconciliation compares every required source pair with zero actions', () => {
  const result = reconcileOperationalSources({ canonicalOrderId: 'fixture-order', identityStatus: 'EXACT', snapshots: complete, observedAt: AT });
  assert.equal(result.records.length, 5);
  assert.equal(result.counts.MATCH, 4);
  assert.equal(result.counts.UNEXPECTED_DIFFERENCE, 1);
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
});

test('reconciliation exposes missing, stale, out-of-order, pagination and identity states', () => {
  const missing = reconcileOperationalSources({ canonicalOrderId: 'fixture-order', identityStatus: 'EXACT', snapshots: { ...complete, dropea_get: null }, observedAt: AT });
  assert.equal(missing.records[0].operational_state, 'MISSING_EVENT');
  const stale = reconcileOperationalSources({ canonicalOrderId: 'fixture-order', identityStatus: 'EXACT', snapshots: complete, sourceHealth: { dropea_get: { freshness: 'STALE' } }, observedAt: AT });
  assert.equal(stale.records[0].operational_state, 'STALE');
  const ordering = reconcileOperationalSources({ canonicalOrderId: 'fixture-order', identityStatus: 'EXACT', snapshots: complete, sourceHealth: { chatby_webhook: { out_of_order: true } }, observedAt: AT });
  assert.equal(ordering.records[1].operational_state, 'OUT_OF_ORDER');
  const pagination = reconcileOperationalSources({ canonicalOrderId: 'fixture-order', identityStatus: 'EXACT', snapshots: complete, sourceHealth: { dropea_get: { pagination_complete: false } }, observedAt: AT });
  assert.equal(pagination.records[0].operational_state, 'PAGINATION_INCOMPLETE');
  const identity = reconcileOperationalSources({ canonicalOrderId: 'fixture-order', identityStatus: 'PARTIAL', snapshots: complete, observedAt: AT });
  assert.equal(identity.records[0].operational_state, 'IDENTITY_MISMATCH');
});

test('reconciliation refuses customer PII before creating ledger entries', () => {
  assert.throws(() => reconcileOperationalSources({
    canonicalOrderId: 'fixture-order', identityStatus: 'EXACT',
    snapshots: { ...complete, dropea_get: { email: 'fixture@example.com' } }, observedAt: AT
  }), /not allowed|direct PII/);
});
