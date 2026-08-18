import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentInsight } from './incident-insight.mjs';

const base = { status: 'PENDING', is_active: true, dropea_sync_current: true, chatby_sync_current: true, mapping_status: 'MAPPED', interpreted_type: 'ADDRESS_INCORRECT', conversation_status: 'FOUND', operational_response_status: 'VALID_RESPONSE', customer_intent: 'ADDRESS_CHANGE', messages_used: 2 };

test('incident insight uses the exact customer action for a tailored address proposal', () => {
  const result = incidentInsight(base);
  assert.equal(result.customer_evidence.code, 'ADDRESS_CHANGE');
  assert.equal(result.tailored_recommendation.code, 'VALIDATE_NEW_ADDRESS');
  assert.equal(result.tailored_recommendation.steps.length, 3);
  assert.equal(result.external_action_status, 'NOT_EXECUTED');
});

test('missing conversation is explicit and never standardized as no response', () => {
  const result = incidentInsight({ ...base, conversation_status: 'NONE', operational_response_status: 'NO_CONVERSATION', customer_intent: 'UNKNOWN', messages_used: 0 });
  assert.equal(result.customer_evidence.code, 'NO_CONVERSATION');
  assert.match(result.customer_evidence.summary, /no equivale/i);
  assert.equal(result.tailored_recommendation.code, 'LINK_CHATBY_CONVERSATION');
});

test('stale Dropea evidence blocks any resolution proposal', () => {
  const result = incidentInsight({ ...base, dropea_sync_current: false });
  assert.equal(result.tailored_recommendation.code, 'REFRESH_DROPEA_SOURCE');
  assert.equal(result.tailored_recommendation.confidence, 'BLOCKED');
});
