import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CHATBY_TOKEN = 'test-token';
process.env.DROPEA_ACCESS_TOKEN = 'test-token';

const { hasAuthoritativeSubscriberAction } = await import('./unanswered-cancellations.mjs');

test('phone-only fallback metadata cannot suppress a current-order cancellation', () => {
  assert.equal(hasAuthoritativeSubscriberAction(null), false);
});

test('ordinary shipping address fields are data, not a customer action', () => {
  assert.equal(hasAuthoritativeSubscriberAction({
    lead_status: 'REMINDER 3',
    tags: [{ name: 'PED-Nuevo' }],
    user_fields: [
      { name: 'Dropea: Numero', value: '1355101' },
      { name: 'Dirección', value: 'Calle de ejemplo 1' },
      { name: 'Código Postal', value: '28000' }
    ]
  }), false);
});

test('an exact-order customer action remains protected from cancellation', () => {
  assert.equal(hasAuthoritativeSubscriberAction({ lead_status: 'CONFIRMADO' }), true);
  assert.equal(hasAuthoritativeSubscriberAction({
    lead_status: 'NUEVO',
    labels: [{ name: 'CAMBIO DIRECCION' }]
  }), true);
});
