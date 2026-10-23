import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicCustomerIntent, customerConversationIntentForOrder } from '../src/workflows/orders.mjs';
import { classifyCustomerMessages, enrichPendingOrder } from '../src/workflows/operational-orders.mjs';

// Synthetic language and identities only; never copy a customer conversation.
const order = { orderId: '900001', raw: { created_at: '2026-01-01T10:00:00Z', external_order_id: '#5001' } };
const incoming = (content, minute = 1) => ({ role: 'customer', content, raw: { type: 'in', ts: Date.parse(`2026-01-01T10:${String(minute).padStart(2, '0')}:00Z`) / 1000 } });

for (const content of [
  'Sí yo quiero son 29.95 euros', 'Si, yo quiero', 'Yo sí lo quiero',
  'Quiero recibir mi pedido', 'Deseo recibirlo', 'Me gustaría recibir el pedido',
  'Quisiera recibirlo', 'Quiero que me entreguen el pedido', 'Envíamelo por favor',
  'Mándamelo', 'Enviadme el pedido por favor', 'Pueden enviármelo',
  'Acepto mi pedido', 'Autorizo el envío', 'Confirmo mi pedido',
  'Confirmo el pedido. ¿Cuándo llegará?', 'Sí lo quiero, gracias',
  'Confirmar mi pedido', 'Quiero confirmar el pedido', 'Sim, quero', 'Pode enviar', 'Vale'
]) {
  test(`recognizes affirmative order consent: ${content}`, () => {
    const intent = customerConversationIntentForOrder([incoming(content)], order);
    assert.equal(intent?.intent, 'CONFIRM');
    assert.equal(intent.occurred_at, '2026-01-01T10:01:00.000Z');
    assert.equal(classifyCustomerMessages([incoming(content)], order).signal, 'CONFIRM');
  });
}

for (const content of [
  '¿Cuánto vale?', '¿Cómo puedo confirmar mi pedido?', '¿Me lo pueden enviar?',
  'Quiero saber cuánto cuesta', 'Me gustaría saber el precio',
  'Lo quiero solo si llega mañana', 'Si cuesta 20 euros lo quiero',
  'Lo quiero si me hacen descuento', 'Quizás lo quiero', 'No sé si lo quiero',
  'Vale, pero todavía no lo envíes', 'Confirmo, pero no tengo dinero',
  'No puedo recibirlo mañana', 'No he confirmado nada',
  'El bot dice "confirmo el pedido"', 'No quiero cancelarlo',
  'Sigo esperando el pedido', 'No me ha llegado', 'Nadie ha venido',
  'Quiero recibir información', 'Hola', 'Quería saber si puedo cambiarlo'
  , 'cuanto vale', 'qué precio tiene', 'como confirmar mi pedido', 'No recuerdo confirmar',
  'Quiero saber cómo confirmar mi pedido'
]) {
  test(`does not manufacture consent: ${content}`, () => {
    assert.notEqual(customerConversationIntentForOrder([incoming(content)], order)?.intent, 'CONFIRM');
    assert.notEqual(classifyCustomerMessages([incoming(content)], order).signal, 'CONFIRM');
  });
}

for (const later of ['Ya no lo quiero', 'No me lo envíen', 'Necesito cambiar la dirección', 'Lo quiero solo si llega mañana', 'Espera, todavía no', 'Quiero otra oferta']) {
  test(`a later contradiction or unresolved condition blocks the old yes: ${later}`, () => {
    const messages = [incoming('Deseo recibirlo'), incoming(later, 2)];
    assert.notEqual(customerConversationIntentForOrder(messages, order)?.intent, 'CONFIRM');
    assert.notEqual(classifyCustomerMessages(messages, order).signal, 'CONFIRM');
  });
}

test('a clear later decision supersedes an old doubt but an acknowledgement does not', () => {
  assert.equal(customerConversationIntentForOrder([incoming('¿Cuánto cuesta?'), incoming('Confirmo mi pedido', 2)], order).intent, 'CONFIRM');
  assert.equal(customerConversationIntentForOrder([incoming('¿Cuánto cuesta?'), incoming('Vale', 2)], order).intent, 'REVIEW');
  assert.equal(customerConversationIntentForOrder([incoming('No lo quiero'), incoming('Perfecto', 2)], order).intent, 'REVIEW');
});

test('old, outbound, undated and other-order text cannot authorize the current order', () => {
  const old = { ...incoming('Quiero recibirlo'), raw: { type: 'in', ts: Date.parse('2026-01-01T09:00:00Z') / 1000 } };
  assert.notEqual(customerConversationIntentForOrder([old], order)?.intent, 'CONFIRM');
  assert.notEqual(customerConversationIntentForOrder([{ role: 'bot', content: 'Confirmo el pedido', raw: { type: 'out' } }], order)?.intent, 'CONFIRM');
  assert.equal(customerConversationIntentForOrder([{ role: 'customer', content: 'Quiero recibirlo' }], order)?.intent, 'REVIEW');
  assert.equal(customerConversationIntentForOrder([incoming('Confirmo el pedido ES999999')], order)?.intent, 'REVIEW');
  assert.equal(customerConversationIntentForOrder([incoming('Confirmo el pedido #5001')], order)?.intent, 'CONFIRM');
});

test('completed address rule is retained but a later cancellation wins', () => {
  const messages = [incoming('Quiero cambiar la dirección'), incoming('Calle Ejemplo 7, piso 1, 00000 Ciudad', 2)];
  assert.equal(customerConversationIntentForOrder(messages, order)?.intent, 'CONFIRM');
  assert.equal(customerConversationIntentForOrder([...messages, incoming('Ya no lo quiero', 3)], order)?.intent, 'CANCEL');
});

test('plain negation remains a rejection rather than positive receive intent', () => {
  for (const text of ['No quiero recibirlo', 'No deseo recibir el pedido', 'No acepto mi pedido', 'No me lo manden', 'No autorizo el envío', 'No pueden enviármelo', 'Quiero que no me lo envíen']) {
    assert.notEqual(deterministicCustomerIntent([{ content: text }])?.intent, 'CONFIRM', text);
  }
});

test('projection never lets tags or a different order override scoped customer context', async () => {
  const pending = { ...order, status: 'PENDING', customerPhone: '+34600000000', orderAmount: 29.95 };
  for (const [currentOrder, confirmedAt, messages, expected] of [
    ['900001', '2025-12-01T10:00:00Z', [], 'NO_RESPONSE'],
    ['900002', '2026-01-01T10:01:00Z', [incoming('Quiero recibirlo')], 'UNCLEAR'],
    ['900001', '2026-01-01T10:01:00Z', [incoming('No lo quiero', 2)], 'CANCEL'],
    ['900001', '2026-01-01T10:01:00Z', [incoming('Lo quiero solo si llega mañana', 2)], 'UNCLEAR'],
    ['900001', '', [incoming('Deseo recibirlo')], 'CONFIRM']
  ]) {
    const subscriber = { user_ns: 'fixture-thread', phone: pending.customerPhone, lead_status: 'CONFIRMADO', user_fields: [
      { name: 'Dropea: Número', value: currentOrder }, { name: 'P. Confirmado', value: confirmedAt }
    ] };
    const index = { byPhone: new Map([['600000000', [subscriber]]]) };
    const row = await enrichPendingOrder(pending, null, index, new Map([['fixture-thread', Promise.resolve(messages)]]));
    assert.equal(row.customerSignalRaw, expected);
    if (expected !== 'CONFIRM') assert.equal(row.customerConfirmed, false);
  }
});

test('a mentioned price must agree with the order before interpreting affirmative consent', () => {
  assert.equal(customerConversationIntentForOrder([incoming('Si yo quiero son 29.95 euros')], { ...order, orderAmount: 29.95 }).intent, 'CONFIRM');
  assert.equal(customerConversationIntentForOrder([incoming('Si yo quiero son 19.95 euros')], { ...order, orderAmount: 29.95 }).intent, 'REVIEW');
});
