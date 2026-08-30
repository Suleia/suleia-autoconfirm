import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIncidentDiscountResponse,
  customerInteractionAfter,
  findVerifiedTemplateDelivery,
  incidentDiscountPolicy
} from './incident-discount-policy.mjs';

const initialTemplate = {
  type: 'agent',
  created_at: '2026-07-28T08:00:00.000Z',
  mid: 'wamid.INITIAL',
  content: { name: 'dropea_incidencia_mercancia_v1' }
};

function incident(overrides = {}) {
  return {
    incidentType: 'rejected_goods',
    chatbyReadVerified: true,
    chatbyUserNs: 'masked-conversation',
    ...overrides
  };
}

test('waits twenty-four hours from the verified merchandise template delivery', () => {
  const result = incidentDiscountPolicy({
    incident: incident(),
    messages: [initialTemplate],
    now: Date.parse('2026-07-29T07:59:59.000Z'),
    discountTemplateName: 'es_es_dropea_incidencia_descuento_5'
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'waiting_discount_window');
});

test('allows the discount exactly twenty-four hours later with no interaction', () => {
  const result = incidentDiscountPolicy({
    incident: incident(),
    messages: [initialTemplate],
    now: Date.parse('2026-07-29T08:00:00.000Z'),
    discountTemplateName: 'es_es_dropea_incidencia_descuento_5'
  });
  assert.equal(result.eligible, true);
  assert.equal(result.discountAmountEur, 5);
});

test('does not reuse a merchandise template sent before the current incident', () => {
  const result = incidentDiscountPolicy({
    incident: incident({ incidenceDate: '2026-07-28T10:00:00.000Z' }),
    messages: [initialTemplate],
    now: Date.parse('2026-07-29T12:00:00.000Z'),
    discountTemplateName: 'es_es_dropea_incidencia_descuento_5'
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'merchandise_template_before_current_incident');
});

test('any customer message or button after the merchandise template blocks the discount', () => {
  for (const interaction of [
    { direction: 'inbound', created_at: '2026-07-28T09:00:00.000Z', text: 'Entendido' },
    { sender: 'customer', created_at: '2026-07-28T09:00:00.000Z', button_text: 'No quiero el pedido' }
  ]) {
    const result = incidentDiscountPolicy({
      incident: incident(),
      messages: [initialTemplate, interaction],
      now: Date.parse('2026-07-28T13:00:00.000Z'),
      discountTemplateName: 'es_es_dropea_incidencia_descuento_5'
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'customer_interaction_after_merchandise_template');
  }
});

test('fails closed without a wamid or a verified Chatby read', () => {
  assert.equal(incidentDiscountPolicy({
    incident: incident(),
    messages: [{ ...initialTemplate, mid: 'internal-id' }],
    now: Date.parse('2026-07-28T13:00:00.000Z')
  }).reason, 'merchandise_template_not_verified');
  assert.equal(incidentDiscountPolicy({
    incident: incident({ chatbyReadVerified: false }),
    messages: [initialTemplate],
    now: Date.parse('2026-07-28T13:00:00.000Z')
  }).reason, 'chatby_context_unverified');
});

test('an existing verified discount template prevents duplicates', () => {
  const discount = {
    type: 'agent',
    created_at: '2026-07-28T12:00:00.000Z',
    mid: 'wamid.DISCOUNT',
    content: { name: 'es_es_dropea_incidencia_descuento_5' }
  };
  const result = incidentDiscountPolicy({
    incident: incident(),
    messages: [initialTemplate, discount],
    now: Date.parse('2026-07-28T13:00:00.000Z'),
    discountTemplateName: 'es_es_dropea_incidencia_descuento_5'
  });
  assert.equal(result.reason, 'discount_template_already_sent');
});

test('classifies acceptance, rejection and silence after the discount delivery', () => {
  const discount = {
    type: 'agent',
    created_at: '2026-07-28T12:00:00.000Z',
    mid: 'wamid.DISCOUNT',
    content: { name: 'es_es_dropea_incidencia_descuento_5' }
  };
  assert.equal(classifyIncidentDiscountResponse([discount], 'es_es_dropea_incidencia_descuento_5').status, 'NO_RESPONSE');
  assert.equal(classifyIncidentDiscountResponse([
    discount,
    { direction: 'inbound', created_at: '2026-07-28T12:05:00.000Z', button_text: 'Quiero el descuento' }
  ], 'es_es_dropea_incidencia_descuento_5').status, 'DISCOUNT_ACCEPTED');
  assert.equal(classifyIncidentDiscountResponse([
    discount,
    { direction: 'inbound', created_at: '2026-07-28T12:05:00.000Z', button_text: 'No quiero el pedido' }
  ], 'es_es_dropea_incidencia_descuento_5').status, 'DISCOUNT_REJECTED');
});

test('unknown interaction timestamps fail closed and internal ids do not verify delivery', () => {
  assert.ok(customerInteractionAfter(
    [{ direction: 'inbound', text: 'mensaje sin fecha' }],
    '2026-07-28T08:00:00.000Z'
  ));
  assert.equal(findVerifiedTemplateDelivery(
    [{ ...initialTemplate, mid: 'internal-id' }],
    'dropea_incidencia_mercancia_v1'
  ), null);
});
