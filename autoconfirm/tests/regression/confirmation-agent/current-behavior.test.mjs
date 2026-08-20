import './isolated-env.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

const {
  customerConversationIntentForOrder,
  deterministicCustomerIntent,
  subscriberConfirmationIsCurrent
} = await import('../../../src/workflows/orders.mjs');

function customer(content, createdAt) {
  return { role: 'customer', content, raw: { direction: 'inbound', created_at: createdAt } };
}

function subscriber(confirmedAt) {
  return {
    lead_status: 'CONFIRMADO',
    tags: [{ name: 'PED-Confirmado' }],
    labels: [{ name: 'CONFIRMADO' }],
    user_fields: [
      { name: 'Dropea: Numero', value: 'fixture-order' },
      { name: 'P. Confirmado', value: confirmedAt }
    ]
  };
}

const order = {
  orderId: 'fixture-order',
  createdAt: '2026-08-19T09:00:00.000Z',
  raw: { created_at: '2026-08-19T09:00:00.000Z' }
};

const intentCases = [
  ['Sí, lo quiero', { intent: 'CONFIRM', confidence: 100, reason: 'El cliente confirma el pedido mediante respuesta o boton de WhatsApp.' }],
  ['No lo quiero', { intent: 'CANCEL', confidence: 100, reason: 'El cliente no confirma el pedido.' }],
  ['Quiero cambiar la dirección', { intent: 'ADDRESS_CHANGE', confidence: 100, reason: 'El cliente pide cambiar o corregir datos de entrega; no se debe confirmar hasta revisar direccion.' }],
  ['Me he equivocado de oferta', { intent: 'PROMOTION_CHANGE', confidence: 98, reason: 'El cliente quiere sustituir el pedido confirmado por otra oferta o promocion.' }],
  ['Gracias por avisar', null]
];

for (const [message, expected] of intentCases) {
  test(`current deterministic intent is frozen for: ${message}`, () => {
    assert.deepEqual(deterministicCustomerIntent([customer(message, '2026-08-19T10:00:00.000Z')]), expected);
  });
}

test('the latest recognized inbound customer message wins between confirmation and cancellation', () => {
  const confirmedLast = customerConversationIntentForOrder([
    customer('No lo quiero', '2026-08-19T10:00:00.000Z'),
    customer('Finalmente sí, lo quiero', '2026-08-19T10:30:00.000Z')
  ], order);
  assert.equal(confirmedLast.intent, 'CONFIRM');
  assert.equal(confirmedLast.source, 'customer_text');
  assert.equal(confirmedLast.customer_message, 'Finalmente sí, lo quiero');

  const cancelledLast = customerConversationIntentForOrder([
    customer('Sí, lo quiero', '2026-08-19T10:00:00.000Z'),
    customer('Finalmente no lo quiero', '2026-08-19T10:30:00.000Z')
  ], order);
  assert.equal(cancelledLast.intent, 'CANCEL');
  assert.equal(cancelledLast.source, 'customer_message');
  assert.equal(cancelledLast.customer_message, 'Finalmente no lo quiero');
});

test('outbound bot text is not treated as a customer confirmation', () => {
  const result = customerConversationIntentForOrder([{
    role: 'bot', content: 'Confirma tu pedido', raw: { direction: 'outbound', created_at: '2026-08-19T10:00:00.000Z' }
  }], order);
  assert.equal(result, null);
});

test('confirmation freshness remains tied to the current order window', () => {
  assert.equal(subscriberConfirmationIsCurrent(subscriber('2026-08-18T09:00:00.000Z'), order), false);
  assert.equal(subscriberConfirmationIsCurrent(subscriber('2026-08-19T09:01:00.000Z'), order), true);
  assert.equal(subscriberConfirmationIsCurrent(subscriber(''), order), false);
  assert.equal(subscriberConfirmationIsCurrent(
    subscriber('2026-08-18T09:00:00.000Z'),
    order,
    '2026-08-19T09:02:00.000Z'
  ), true);
});
