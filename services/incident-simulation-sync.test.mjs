import test from 'node:test';
import assert from 'node:assert/strict';
import { syncIncidentSimulations } from './incident-simulation-sync.mjs';

test('incident sync reads mirror rows and records only zero-action simulations', async () => {
  const calls = [];
  const pool = { query: async (sql) => sql.includes('FROM read_models.operations_incident_records') ? { rows: [{
    canonical_issue_id: 'issue-fixture', canonical_order_id: 'order-fixture', dropea_issue_id: 'di',
    type: 'RECIPIENT_ABSENT', raw_type: 'RECIPIENT_ABSENT', mapping_status: 'MAPPED',
    status: 'PENDING', is_active: true, carrier: 'GLS', allowed_resolution_options: ['RETRY'],
    updated_at: '2026-08-02T08:00:00Z', observed_at: '2026-08-02T08:01:00Z',
    freshness: 'FRESH', source_version: '0.1.0', identity_status: 'EXACT', total_amount: 20,
    lifecycle_classification: 'ACTIVE', canonical_state: 'DELIVERY_ATTEMPTED', delivery_attempt_number: '1',
    discount_status: 'NOT_OFFERED', conversation_source: 'AVAILABLE', conversation_status: 'FOUND'
  }] } : { rows: [] } };
  const projector = {
    upsertIncidentInterpretation: async (value) => calls.push(['interpretation', value]),
    recordIncidentSimulation: async (value) => calls.push(['simulation', value]),
    applyIncidentDecision: async (value) => calls.push(['decision', value])
  };
  const result = await syncIncidentSimulations({ pool, projector, now: () => new Date('2026-08-02T09:00:00Z') });
  assert.equal(result.simulated, 1);
  assert.equal(result.actions_executed, 0);
  assert.equal(result.external_write_attempted, false);
  assert.deepEqual(calls.map(([type]) => type), ['interpretation','simulation','decision']);
});

test('incident sync blocks decisions and timers when Chatby source is unavailable', async () => {
  const calls = [];
  const pool = { query: async (sql) => sql.includes('FROM read_models.operations_incident_records') ? { rows: [{
    canonical_issue_id: 'issue-waiting', canonical_order_id: 'order-waiting', type: 'UNKNOWN',
    status: 'PENDING', is_active: true, carrier: 'GLS', allowed_resolution_options: [],
    updated_at: '2026-08-02T08:00:00Z', observed_at: '2026-08-02T08:01:00Z',
    freshness: 'FRESH', source_version: '0.1.0', identity_status: 'EXACT', total_amount: 20,
    lifecycle_classification: 'ACTIVE', canonical_state: 'DELIVERY_ATTEMPTED',
    conversation_source: 'UNAVAILABLE', conversation_status: 'NONE',
    conversation_reason: 'NO_EXACT_TECHNICAL_REFERENCE', blocking_reasons: ['DROPEA_CARRIER_CODE_UNKNOWN']
  }] } : { rows: [] } };
  const projector = {
    upsertIncidentInterpretation: async (value) => calls.push(['interpretation', value]),
    recordIncidentSimulation: async (value) => calls.push(['simulation', value]),
    applyIncidentDecision: async (value) => calls.push(['decision', value])
  };
  const result = await syncIncidentSimulations({ pool, projector, now: () => new Date('2026-08-02T09:00:00Z') });
  assert.equal(result.blocked, 1);
  assert.deepEqual(calls.map(([type]) => type), ['interpretation', 'simulation']);
  assert.equal(calls[1][1].simulated_action, null);
  assert.equal(calls[1][1].blocking_reasons.includes('CHATBY_NONE:NO_EXACT_TECHNICAL_REFERENCE'), true);
});

test('incident sync preserves exact-order evidence after a later incident timestamp update', async () => {
  const calls = [];
  const pool = { query: async (sql) => {
    if (sql.includes('FROM read_models.operations_incident_records')) return { rows: [{
      canonical_issue_id: 'issue-current', canonical_order_id: 'order-current',
      type: 'RECIPIENT_ABSENT', raw_type: 'RECIPIENT_ABSENT', mapping_status: 'MAPPED',
      status: 'PENDING', is_active: true, carrier: 'GLS', allowed_resolution_options: ['RETRY'],
      updated_at: '2026-09-01T17:07:03.475Z', observed_at: '2026-09-02T17:00:00Z',
      freshness: 'FRESH', source_version: '0.1.0', identity_status: 'EXACT', total_amount: 20,
      lifecycle_classification: 'ACTIVE', canonical_state: 'DELIVERY_ATTEMPTED',
      delivery_attempt_number: '1', discount_status: 'NOT_OFFERED', conversation_status: 'FOUND'
    }] };
    assert.match(sql, /incident_version,relevance_status,intent/);
    return { rows: [{
      canonical_issue_id: 'issue-current', direction: 'INBOUND', message_type: 'TEXT',
      created_at: '2026-09-01T17:04:11.000Z', incident_version: '2026-09-01T09:49:50.992Z',
      relevance_status: 'CURRENT_ORDER_EXACT_MATCH', intent: 'UNKNOWN', intent_confidence: 0,
      chatby_message_id: 'message-current'
    }] };
  } };
  const projector = {
    upsertIncidentInterpretation: async (value) => calls.push(['interpretation', value]),
    recordIncidentSimulation: async (value) => calls.push(['simulation', value]),
    applyIncidentDecision: async (value) => calls.push(['decision', value])
  };
  await syncIncidentSimulations({ pool, projector, now: () => new Date('2026-09-02T17:00:00Z') });
  assert.equal(calls[0][0], 'interpretation');
  assert.equal(calls[0][1].has_customer_replied, true);
  assert.equal(calls[0][1].messages_used, 1);
});
