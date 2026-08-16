import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationsProjector } from '../src/operations/projector.mjs';

test('Operations projector writes only masked shadow read models with zero-action result', async () => {
  const calls = [];
  const projector = new OperationsProjector({ query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 1 }; } });
  const result = await projector.upsertOrder({
    canonical_order_id: 'order-fixture', dropea_order_id: '24', external_order_id_hash: 'a'.repeat(64),
    status: 'SHIPPING', sub_status: 'SHIPPED', canonical_state: 'IN_TRANSIT',
    product_summary: { total_units: 1 }, total_amount: 10, currency: 'EUR', carrier: 'GLS',
    service_type: '74', tracking_reference_masked: 'b'.repeat(64), identity_status: 'EXACT',
    data_freshness: 'FRESH', updated_at: '2026-08-01T12:00:00Z', source_version: '0.1.0', schema_version: '1.0.0'
  });
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
  assert.match(calls[0].sql, /SHADOW_READ_ONLY/);
  assert.doesNotMatch(calls[0].sql, /DELETE|TRUNCATE/);
});

test('Operations projector rejects direct customer PII', async () => {
  const projector = new OperationsProjector({ query: async () => ({ rowCount: 1 }) });
  await assert.rejects(projector.upsertOrder({
    canonical_order_id: 'order-fixture', dropea_order_id: '24', customer_email: 'fixture@example.com'
  }), /PII/);
});

test('Operations projector stores only a masked Chatby category with zero writes', async () => {
  const calls = [];
  const projector = new OperationsProjector({ query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 1 }; } });
  const result = await projector.upsertOperationalOrderSignal({
    canonical_order_id: 'order-fixture', has_customer_replied: false,
    latest_inbound_message_at: null, detected_intent: 'NO_RESPONSE', confidence: 0.25,
    messages_used: 0, explanation_masked: { source: 'RENDER_OPERATIONAL_ORDERS', source_intent: 'NO_RESPONSE' },
    freshness: 'FRESH', updated_at: '2026-08-16T19:00:00Z', actions_executed: 0, production_writes: 0
  });
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
  assert.match(calls[0].sql, /operations_conversation_summaries/);
  assert.doesNotMatch(JSON.stringify(calls), /customer@example|\+34/);
});
