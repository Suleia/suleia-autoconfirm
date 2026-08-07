import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationsProjector } from '../src/operations/projector.mjs';

function safeProjectorPool(calls) {
  return { query: async (sql, values) => {
    calls.push({ sql, values });
    if (/INSERT INTO core\.customers_masked/.test(sql)) return { rowCount: 1, rows: [{ id: 'customer-safe-id' }] };
    if (/INSERT INTO core\.orders/.test(sql)) return { rowCount: 1, rows: [{ id: 'core-order-safe-id' }] };
    if (/SELECT id FROM core\.orders/.test(sql)) return { rowCount: 1, rows: [{ id: 'core-order-safe-id' }] };
    return { rowCount: 1, rows: [] };
  } };
}

test('Operations projector writes only masked shadow read models with zero-action result', async () => {
  const calls = [];
  const projector = new OperationsProjector(safeProjectorPool(calls));
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
  assert.ok(calls.some((call) => /INSERT INTO events\.order_events/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO core\.order_digital_twins/.test(call.sql)));
  assert.equal(calls.some((call) => /INSERT INTO (chatby|dropea)|UPDATE (chatby|dropea)/i.test(call.sql)), false);
});

test('Operations projector rejects direct customer PII', async () => {
  const projector = new OperationsProjector({ query: async () => ({ rowCount: 1 }) });
  await assert.rejects(projector.upsertOrder({
    canonical_order_id: 'order-fixture', dropea_order_id: '24', customer_email: 'fixture@example.com'
  }), /PII/);
});

test('Dropea refresh preserves a previously available Chatby source', async () => {
  const calls = [];
  const projector = new OperationsProjector(safeProjectorPool(calls));
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

test('Operational truth projects masked customer, incident event and no external action', async () => {
  const calls = [];
  const projector = new OperationsProjector(safeProjectorPool(calls));
  const customerHash = 'c'.repeat(64);
  const orderResult = await projector.projectOperationalTruthOrder({
    canonical_order_id: 'order-safe', customer_identity_hash: customerHash,
    status: 'SHIPPING', sub_status: 'SHIPPED', canonical_state: 'IN_TRANSIT',
    currency: 'EUR', total_amount: 10, carrier: 'GLS', source_version: '0.1.0',
    created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T12:00:00Z',
    observed_at: '2026-08-01T12:01:00Z', payload_hash: 'd'.repeat(64),
    data_freshness: 'FRESH', identity_status: 'EXACT',
    identity: { links: [{ namespace: 'dropea_order_id', value_hash: 'e'.repeat(64) }] }
  });
  const issueResult = await projector.projectOperationalTruthIssue({
    canonical_order_id: 'order-safe', canonical_issue_id: 'issue-safe',
    type: 'RECIPIENT_ABSENT', status: 'PENDING', is_active: true, carrier: 'GLS',
    initial_carrier_code: 'NAM', initial_carrier_description_sanitized: 'RECIPIENT ABSENT',
    mapping_status: 'MAPPED', source_version: '0.1.0',
    created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T12:00:00Z',
    resolved_at: null, payload_hash: 'f'.repeat(64), freshness: 'FRESH'
  });
  assert.equal(orderResult.actions_executed, 0);
  assert.equal(issueResult.production_writes, 0);
  const customerWrite = calls.find((call) => /INSERT INTO core\.customers_masked/.test(call.sql));
  assert.deepEqual(customerWrite.values, [customerHash]);
  const eventWrites = calls.filter((call) => /INSERT INTO events\.order_events/.test(call.sql));
  assert.equal(eventWrites.length, 2);
  assert.match(eventWrites[0].values[3], /"canonical_state":"IN_TRANSIT"/);
  assert.doesNotMatch(eventWrites.map((call) => call.values.join('|')).join('|'), /@|\+34|664381580/);
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
