import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncidentSimulation } from '../src/incident/simulation-record.mjs';

const issue = {
  canonical_issue_id: 'issue-fixture', canonical_order_id: 'order-fixture', type: 'RECIPIENT_ABSENT',
  raw_type: 'RECIPIENT_ABSENT', mapping_status: 'MAPPED', status: 'PENDING', is_active: true,
  carrier: 'GLS', allowed_resolution_options: ['RETRY'], updated_at: '2026-08-01T10:00:00Z',
  observed_at: '2026-08-01T10:01:00Z', freshness: 'FRESH', source_version: '0.1.0', discount_status: 'NOT_OFFERED'
};
const order = { canonical_order_id: 'order-fixture', identity_status: 'EXACT', total_amount: 20, lifecycle_classification: 'ACTIVE' };

test('builds an immutable zero-action simulation from current inbound evidence', () => {
  const result = buildIncidentSimulation({ issue, order, now: '2026-08-01T12:00:00Z', gls: { delivery_attempt_number: 1 }, events: [{
    canonical_issue_id: 'issue-fixture', incident_version: issue.updated_at, direction: 'INBOUND',
    intent: 'DELIVERY_RETRY', intent_confidence: 1, chatby_message_id: 'message-fixture', created_at: '2026-08-01T11:00:00Z'
  }] });
  assert.equal(result.decision.proposed_resolution, 'RETRY');
  assert.equal(result.simulation_record.customer_intent, 'DELIVERY_RETRY');
  assert.equal(result.simulation_record.execution_available, false);
  assert.equal(result.simulation_record.external_write_attempted, false);
  assert.equal(result.simulation_record.actions_executed, 0);
});

test('stale outbound and older issue messages cannot change the decision', () => {
  const result = buildIncidentSimulation({ issue, order, now: '2026-08-01T12:00:00Z', gls: { delivery_attempt_number: 1 }, events: [
    { canonical_issue_id: 'issue-fixture', incident_version: 'old', direction: 'INBOUND', intent: 'FINAL_REJECTION', created_at: '2026-08-01T09:00:00Z' },
    { canonical_issue_id: 'issue-fixture', incident_version: issue.updated_at, direction: 'OUTBOUND', intent: 'FINAL_REJECTION', created_at: '2026-08-01T11:00:00Z' }
  ] });
  assert.equal(result.interpretation.customer_intent, 'NO_RESPONSE');
  assert.equal(result.decision.proposed_resolution, null);
});
