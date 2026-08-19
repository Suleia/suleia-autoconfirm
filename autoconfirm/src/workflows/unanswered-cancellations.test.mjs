import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CHATBY_TOKEN = 'test-token';
process.env.DROPEA_ACCESS_TOKEN = 'test-token';

const { hasAuthoritativeSubscriberAction } = await import('./unanswered-cancellations.mjs');

test('phone-only fallback metadata cannot suppress a current-order cancellation', () => {
  assert.equal(hasAuthoritativeSubscriberAction(null), false);
});

test('an exact-order customer action remains protected from cancellation', () => {
  assert.equal(hasAuthoritativeSubscriberAction({ lead_status: 'CONFIRMADO' }), true);
  assert.equal(hasAuthoritativeSubscriberAction({
    lead_status: 'NUEVO',
    labels: [{ name: 'CAMBIO DIRECCION' }]
  }), true);
});
