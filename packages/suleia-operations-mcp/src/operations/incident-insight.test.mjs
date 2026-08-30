import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentInsight } from './incident-insight.mjs';

const base = { status: 'PENDING', is_active: true, dropea_sync_current: true, chatby_sync_current: true, mapping_status: 'MAPPED', interpreted_type: 'ADDRESS_INCORRECT', conversation_status: 'FOUND', operational_response_status: 'VALID_RESPONSE', customer_intent: 'ADDRESS_CHANGE', messages_used: 2 };

test('incident insight uses the exact customer action for a tailored address proposal', () => {
  const result = incidentInsight({
    ...base,
    latest_customer_message: 'Calle Ejemplo 31, 28001 Madrid',
    latest_operator_message: 'Indíquenos la dirección completa y el código postal.',
    latest_customer_message_relation: 'AFTER_INCIDENT',
    latest_private_customer_message_at: '2026-08-20T10:00:00Z',
    allowed_resolution_options: ['PROVIDE_SOLUTION','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'ADDRESS_CHANGE');
  assert.equal(result.tailored_recommendation.code, 'PROVIDE_CORRECTED_ADDRESS_TO_DROPEA');
  assert.equal(result.tailored_recommendation.prepared_dropea_solution.address.complete, true);
  assert.equal(result.tailored_recommendation.prepared_dropea_solution.execution_status, 'NOT_EXECUTED');
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

test('real Chatby delivery-slot button becomes next-day redelivery with an order-phone call', () => {
  const result = incidentInsight({
    ...base, interpreted_type: 'RECIPIENT_ABSENT', operational_response_status: 'NO_VALID_RESPONSE',
    customer_intent: 'NO_RESPONSE', messages_used: 0,
    latest_customer_message: 'Mañana por mañana / tarde', latest_customer_message_relation: 'AFTER_INCIDENT',
    customer_phone: '+34999999999', allowed_resolution_options: ['PROVIDE_SOLUTION','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'DELIVERY_RETRY');
  assert.equal(result.customer_evidence.delivery_instruction.requested_window, 'MORNING_OR_AFTERNOON');
  assert.equal(result.tailored_recommendation.resolution_option, 'PROVIDE_SOLUTION');
  assert.equal(result.tailored_recommendation.customer_instruction.call_before_delivery, true);
});

test('a fresh affirmative answer to the exact receive question recovers a refused delivery', () => {
  const result = incidentInsight({
    ...base,
    interpreted_type: 'REFUSED_BY_RECIPIENT',
    customer_intent: 'UNKNOWN', messages_used: 1,
    latest_customer_message: 'Sí',
    latest_operator_message: 'Nos informan de que no quiere el pedido. ¿Quiere recibir el pedido?',
    latest_customer_message_relation: 'AFTER_INCIDENT',
    allowed_resolution_options: ['RETURN_REQUESTED','PROVIDE_SOLUTION','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'CONFIRM');
  assert.equal(result.customer_evidence.interpretation_basis, 'AFFIRMATIVE_REPLY_TO_RECEIVE_QUESTION');
  assert.equal(result.tailored_recommendation.code, 'RECOVER_DELIVERY_AFTER_REFUSAL');
  assert.equal(result.tailored_recommendation.resolution_option, 'PROVIDE_SOLUTION');
  assert.equal(result.tailored_recommendation.decision_goal, 'RECOVER_DELIVERY_AFTER_PRIOR_REFUSAL');
});

test('a refused delivery without later acceptance remains a return proposal', () => {
  const result = incidentInsight({
    ...base,
    interpreted_type: 'REFUSED_BY_RECIPIENT',
    operational_response_status: 'NO_VALID_RESPONSE', customer_intent: 'NO_RESPONSE', messages_used: 0,
    allowed_resolution_options: ['RETURN_REQUESTED','MANAGED_BY_CLIENT']
  });
  assert.equal(result.tailored_recommendation.code, 'RETURN_AFTER_REJECTION');
  assert.equal(result.tailored_recommendation.resolution_option, 'RETURN_REQUESTED');
  assert.equal(result.tailored_recommendation.decision_goal, 'STOP_UNWANTED_DELIVERY_AND_RETURN');
});

test('an accepted 5 EUR discount becomes a prominent incident-specific recovery proposal', () => {
  const result = incidentInsight({
    ...base,
    interpreted_type: 'REFUSED_BY_RECIPIENT',
    customer_intent: 'DISCOUNT_ACCEPTED',
    messages_used: 1,
    latest_customer_message: 'Quiero el descuento',
    latest_customer_message_relation: 'AFTER_INCIDENT',
    allowed_resolution_options: ['RETURN_REQUESTED','PROVIDE_SOLUTION','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'DISCOUNT_ACCEPTED');
  assert.equal(result.customer_evidence.title, 'Descuento de 5 € aceptado');
  assert.equal(result.tailored_recommendation.code, 'APPLY_ACCEPTED_DISCOUNT_AND_REDELIVER');
  assert.equal(result.tailored_recommendation.resolution_option, 'PROVIDE_SOLUTION');
  assert.match(result.tailored_recommendation.guardrail, /no aplicar más de 5/i);
});

test('a rejected discount stops further offers and proposes return', () => {
  const result = incidentInsight({
    ...base,
    interpreted_type: 'REFUSED_BY_RECIPIENT',
    customer_intent: 'DISCOUNT_REJECTED',
    messages_used: 1,
    latest_customer_message: 'No quiero el descuento',
    latest_customer_message_relation: 'AFTER_INCIDENT',
    allowed_resolution_options: ['RETURN_REQUESTED','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'DISCOUNT_REJECTED');
  assert.equal(result.tailored_recommendation.code, 'RETURN_AFTER_DISCOUNT_REJECTION');
  assert.equal(result.tailored_recommendation.resolution_option, 'RETURN_REQUESTED');
});

test('a weekday availability produces a literal scheduled-delivery solution with causal limits', () => {
  const result = incidentInsight({
    ...base, interpreted_type: 'RECIPIENT_ABSENT', operational_response_status: 'NO_VALID_RESPONSE',
    customer_intent: 'NO_RESPONSE', messages_used: 0,
    latest_customer_message: 'Miércoles temprano mejor', latest_customer_message_relation: 'AFTER_INCIDENT',
    allowed_resolution_options: ['PROVIDE_SOLUTION','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'DELIVERY_RETRY');
  assert.equal(result.tailored_recommendation.code, 'NOTIFY_DROPEA_SCHEDULED_DELIVERY');
  assert.equal(result.tailored_recommendation.resolution_option, 'PROVIDE_SOLUTION');
  assert.equal(result.tailored_recommendation.decision_goal, 'COMPLETE_DELIVERY_IN_CUSTOMER_CONFIRMED_SLOT');
  assert.match(result.tailored_recommendation.guardrail, /transportista/i);
});

test('address supplied in reply to the exact request is evidence, not a generic message', () => {
  const result = incidentInsight({
    ...base, operational_response_status: 'NO_VALID_RESPONSE', customer_intent: 'NO_RESPONSE', messages_used: 0,
    latest_customer_message: 'Calle Ejemplo 31, 28001 Madrid',
    latest_operator_message: 'Indíquenos la dirección completa y el código postal.',
    latest_customer_message_relation: 'AFTER_INCIDENT',
    allowed_resolution_options: ['PROVIDE_SOLUTION','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'ADDRESS_CHANGE');
  assert.equal(result.customer_evidence.interpretation_basis, 'ADDRESS_DATA_REPLY_TO_ADDRESS_REQUEST');
  assert.equal(result.tailored_recommendation.code, 'PROVIDE_CORRECTED_ADDRESS_TO_DROPEA');
  assert.equal(result.tailored_recommendation.decision_goal, 'RESTORE_DELIVERABILITY_WITH_VERIFIED_ADDRESS');
});

test('partial address reply is retained but blocks Dropea until missing fields are supplied', () => {
  const result = incidentInsight({
    ...base, operational_response_status: 'NO_VALID_RESPONSE', customer_intent: 'NO_RESPONSE', messages_used: 0,
    latest_customer_message: 'La nueva es Calle Ejemplo 31',
    latest_operator_message: 'Indíquenos la dirección completa y el código postal.',
    latest_customer_message_relation: 'AFTER_INCIDENT',
    allowed_resolution_options: ['PROVIDE_SOLUTION','MANAGED_BY_CLIENT']
  });
  assert.equal(result.customer_evidence.code, 'ADDRESS_CHANGE');
  assert.equal(result.tailored_recommendation.code, 'REQUEST_MISSING_ADDRESS_FIELDS');
  assert.deepEqual(result.tailored_recommendation.prepared_dropea_solution.address.missing_fields, ['POSTAL_CODE', 'LOCALITY']);
  assert.equal(result.tailored_recommendation.prepared_dropea_solution.execution_status, 'BLOCKED_INCOMPLETE_ADDRESS');
});
