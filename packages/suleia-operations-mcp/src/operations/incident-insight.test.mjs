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

test('a known Dropea type remains actionable when only the carrier code mapping is pending', () => {
  const result = incidentInsight({
    ...base, interpreted_type: 'RECIPIENT_ABSENT', raw_type: 'RECIPIENT_ABSENT',
    mapping_status: 'UNMAPPED', operational_response_status: 'NO_VALID_RESPONSE',
    customer_intent: 'NO_RESPONSE', messages_used: 0,
    initial_carrier_description_sanitized: 'AUSENTE SEGUNDA VEZ',
    allowed_resolution_options: ['MANAGED_BY_CLIENT','RETURN_REQUESTED','PICKUP_AT_AGENCY']
  });
  assert.equal(result.tailored_recommendation.code, 'OFFER_PICKUP_THEN_RETURN');
  assert.equal(result.tailored_recommendation.resolution_option, 'MANAGED_BY_CLIENT');
});

test('different incident facts produce different concrete solutions', () => {
  const address = incidentInsight({ ...base, mapping_status: 'UNMAPPED', operational_response_status: 'NO_VALID_RESPONSE', customer_intent: 'NO_RESPONSE', messages_used: 0, allowed_resolution_options: ['MANAGED_BY_CLIENT'] });
  const data = incidentInsight({ ...base, interpreted_type: 'PENDING_DATA', mapping_status: 'UNMAPPED', operational_response_status: 'NO_VALID_RESPONSE', customer_intent: 'NO_RESPONSE', messages_used: 0, allowed_resolution_options: ['MANAGED_BY_CLIENT','PROVIDE_SOLUTION'] });
  assert.equal(address.tailored_recommendation.code, 'REQUEST_COMPLETE_ADDRESS');
  assert.equal(data.tailored_recommendation.code, 'REQUEST_MISSING_DATA');
  assert.notEqual(address.tailored_recommendation.summary, data.tailored_recommendation.summary);
});

test('exact Chatby next-day delivery instruction overrides stale no-response projection', () => {
  const result = incidentInsight({
    ...base,
    interpreted_type: 'RECIPIENT_ABSENT',
    operational_response_status: 'NO_VALID_RESPONSE', customer_intent: 'NO_RESPONSE', messages_used: 0,
    latest_customer_message: 'Quiero que se entregue mañana por la mañana o por la tarde. Llamad antes de entregar.',
    latest_customer_message_relation: 'AFTER_INCIDENT',
    latest_private_customer_message_at: '2026-08-19T14:00:00Z',
    customer_phone: '+34999999999',
    allowed_resolution_options: ['MANAGED_BY_CLIENT','PROVIDE_SOLUTION']
  });
  assert.equal(result.customer_evidence.code, 'DELIVERY_RETRY');
  assert.deepEqual(result.customer_evidence.delivery_instruction, {
    requested_day: 'NEXT_DAY', requested_window: 'MORNING_OR_AFTERNOON',
    call_before_delivery: true, is_delivery_request: true
  });
  assert.equal(result.tailored_recommendation.code, 'NOTIFY_DROPEA_NEXT_DAY_DELIVERY');
  assert.equal(result.tailored_recommendation.resolution_option, 'PROVIDE_SOLUTION');
  assert.equal(result.tailored_recommendation.customer_instruction.call_before_delivery, true);
  assert.equal(result.tailored_recommendation.customer_instruction.callback_phone_available, true);
  assert.equal(result.external_action_status, 'NOT_EXECUTED');
});
