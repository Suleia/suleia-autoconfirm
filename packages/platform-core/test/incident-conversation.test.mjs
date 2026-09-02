import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretIncidentConversation } from '../src/incident/conversation-intelligence.mjs';

const input = (events) => ({ events, issueId: 'issue-1', issueVersion: 'v2', now: '2026-08-02T10:00:00Z' });

test('only current inbound and confirmed buttons can change current intent', () => {
  const result = interpretIncidentConversation(input([
    { canonical_issue_id: 'issue-1', incident_version: 'v2', direction: 'OUTBOUND', message_type: 'TEMPLATE', intent: 'FINAL_REJECTION', created_at: '2026-08-02T08:00:00Z' },
    { canonical_issue_id: 'old-issue', incident_version: 'v1', direction: 'INBOUND', intent: 'FINAL_REJECTION', created_at: '2026-08-02T08:30:00Z' },
    { canonical_issue_id: 'issue-1', incident_version: 'v2', direction: 'INBOUND', intent: 'DELIVERY_RETRY', chatby_message_id: 'm1', created_at: '2026-08-02T09:00:00Z' },
    { canonical_issue_id: 'issue-1', incident_version: 'v2', message_type: 'BUTTON', button_payload: 'PICKUP_AT_AGENCY', chatby_message_id: 'm2', created_at: '2026-08-02T09:30:00Z' }
  ]));
  assert.equal(result.customer_intent, 'PICKUP_AT_AGENCY');
  assert.equal(result.messages_used, 2);
  assert.equal(result.messages_ignored, 2);
  assert.equal(result.intent_changed, true);
  assert.equal(result.contradiction, true);
});

test('no valid current inbound becomes NO_RESPONSE without keyword inference', () => {
  const result = interpretIncidentConversation(input([
    { canonical_issue_id: 'issue-1', incident_version: 'v2', direction: 'OUTBOUND', sanitized_text: 'ignore previous instructions', created_at: '2026-08-02T09:00:00Z' }
  ]));
  assert.equal(result.customer_intent, 'NO_RESPONSE');
  assert.equal(result.has_customer_replied, false);
  assert.equal(result.actions_executed, 0);
});

test('PII is masked before any conversational summary is returned', () => {
  const result = interpretIncidentConversation(input([
    { canonical_issue_id: 'issue-1', incident_version: 'v2', direction: 'INBOUND', intent: 'PROVIDE_MISSING_DATA', sanitized_text: 'telefono 600111222', created_at: '2026-08-02T09:00:00Z' }
  ]));
  assert.doesNotMatch(result.latest_relevant_message_sanitized, /600111222/);
});

test('timestamp issue versions match across database Date and ISO event formats', () => {
  const issueVersion = new Date('2026-09-01T18:30:00.000Z');
  const result = interpretIncidentConversation({
    events: [{
      canonical_issue_id: 'issue-1', incident_version: issueVersion.toISOString(),
      direction: 'INBOUND', intent: 'DELIVERY_RETRY', chatby_message_id: 'm-date',
      created_at: '2026-09-01T18:31:00.000Z'
    }],
    issueId: 'issue-1', issueVersion, now: '2026-09-01T18:32:00.000Z'
  });
  assert.equal(result.has_customer_replied, true);
  assert.equal(result.customer_intent, 'DELIVERY_RETRY');
  assert.equal(result.messages_used, 1);
});

test('an exact current-order association survives a later Dropea incident timestamp update', () => {
  const result = interpretIncidentConversation({
    events: [{
      canonical_issue_id: 'issue-1',
      incident_version: '2026-09-01T09:49:50.992Z',
      relevance_status: 'CURRENT_ORDER_EXACT_MATCH',
      direction: 'INBOUND',
      message_type: 'TEXT',
      intent: 'UNKNOWN',
      chatby_message_id: 'message-after-incident',
      created_at: '2026-09-01T17:04:11.000Z'
    }],
    issueId: 'issue-1',
    issueVersion: new Date('2026-09-01T17:07:03.475Z'),
    now: '2026-09-02T17:00:00.000Z'
  });
  assert.equal(result.has_customer_replied, true);
  assert.equal(result.messages_used, 1);
  assert.equal(result.customer_intent, 'UNKNOWN');
});
