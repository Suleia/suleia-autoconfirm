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
  assert.deepEqual(JSON.parse(calls[0].values[14]), []);
  assert.deepEqual(JSON.parse(calls[0].values[16]), []);
  assert.deepEqual(JSON.parse(calls[2].values[3]), []);
});

test('Operations projector rejects direct customer PII', async () => {
  const projector = new OperationsProjector({ query: async () => ({ rowCount: 1 }) });
  await assert.rejects(projector.upsertOrder({
    canonical_order_id: 'order-fixture', dropea_order_id: '24', customer_email: 'fixture@example.com'
  }), /PII/);
});

test('Dropea refresh preserves a previously available Chatby source', async () => {
  const calls = [];
  const projector = new OperationsProjector({ query: async (sql, values) => {
    calls.push({ sql, values });
    return { rowCount: 1 };
  } });
  await projector.upsertOrder({
    canonical_order_id: 'order-fixture', dropea_order_id: '24', external_order_id_hash: 'a'.repeat(64),
    status: 'SHIPPING', sub_status: 'SHIPPED', canonical_state: 'IN_TRANSIT',
    product_summary: {}, total_amount: 10, currency: 'EUR', carrier: 'GLS',
    identity_status: 'EXACT', data_freshness: 'FRESH', created_at: '2026-08-01T11:00:00Z',
    updated_at: '2026-08-01T12:00:00Z', source_version: '0.1.0', schema_version: '1.0.0'
  });
  const refresh = calls.find((call) => /UPDATE read_models\.operations_order_records SET market/.test(call.sql));
  assert.ok(refresh);
  assert.doesNotMatch(refresh.sql, /conversation_source|interpretation_status/);
});

test('Incident simulation serializes every jsonb value explicitly', async () => {
  const calls = [];
  const projector = new OperationsProjector({ query: async (sql, values) => {
    calls.push({ sql, values });
    return { rowCount: 1 };
  } });
  await projector.recordIncidentSimulation({
    simulation_id: 'simulation-safe', canonical_issue_id: 'issue-safe',
    canonical_order_id: 'order-safe', issue_version: '2026-08-01T10:00:00Z',
    source_event_id: 'source-safe', dropea_snapshot_at: '2026-08-01T10:00:00Z',
    chatby_snapshot_at: '2026-08-01T10:01:00Z', policy_version: 'policy-safe',
    connector_version: '0.1.0', issue_type: 'RECIPIENT_ABSENT',
    customer_has_replied: true, customer_intent: 'DELIVERY_RETRY',
    interpretation_summary: 'CURRENT_INTENT:DELIVERY_RETRY',
    facts_used: ['DROPEA_ISSUE', 'CURRENT_CHATBY_INBOUND'], facts_ignored: [],
    allowed_resolution_options: ['RETRY'], gls_feasibility: { feasible: true },
    simulated_decision: 'PROPOSE_RETRY', simulated_action: { type: 'PREVIEW_ONLY' },
    missing_data: [], blocking_reasons: [], risk: 'LOW', confidence: 0.85,
    qa_status: 'PASS', human_review: false
  });
  const values = calls[0].values;
  assert.deepEqual(JSON.parse(values[14]), ['DROPEA_ISSUE', 'CURRENT_CHATBY_INBOUND']);
  assert.deepEqual(JSON.parse(values[15]), []);
  assert.deepEqual(JSON.parse(values[17]), { feasible: true });
  assert.deepEqual(JSON.parse(values[19]), { type: 'PREVIEW_ONLY' });
  assert.deepEqual(values[16], ['RETRY']);
});
