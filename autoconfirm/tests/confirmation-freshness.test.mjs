import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subscriberConfirmationIsCurrent,
  workflowStatusForPolledOrder
} from '../src/workflows/orders.mjs';

function subscriber(confirmedAt) {
  return {
    lead_status: 'CONFIRMADO',
    tags: [{ name: 'PED-Confirmado' }],
    labels: [{ name: 'CONFIRMADO' }],
    user_fields: [
      { name: 'Dropea: Numero', value: '1315137' },
      { name: 'P. Confirmado', value: confirmedAt }
    ]
  };
}

const order = {
  orderId: '1315137',
  createdAt: '2026-07-23T19:58:09.000Z',
  raw: { created_at: '2026-07-23T19:58:09.000Z' }
};

test('rejects a confirmation inherited from an older order', () => {
  assert.equal(
    subscriberConfirmationIsCurrent(subscriber('2026-06-06T06:58:32.000Z'), order),
    false
  );
});

test('accepts a confirmation timestamp created for the current order', () => {
  assert.equal(
    subscriberConfirmationIsCurrent(subscriber('2026-07-23T19:59:21.000Z'), order),
    true
  );
});

test('does not trust a persistent confirmation tag without a current timestamp', () => {
  assert.equal(
    subscriberConfirmationIsCurrent(subscriber(''), order),
    false
  );
});

test('accepts a current inbound confirmation even if the subscriber field is stale', () => {
  assert.equal(
    subscriberConfirmationIsCurrent(
      subscriber('2026-06-06T06:58:32.000Z'),
      order,
      '2026-07-23T20:01:00.000Z'
    ),
    true
  );
});

test('a still-pending Dropea order leaves stale manual review and is reevaluated', () => {
  assert.equal(
    workflowStatusForPolledOrder({ status: 'MANUAL_REVIEW' }, 'PENDING'),
    'PENDING'
  );
});

test('address correction and terminal safety states remain blocked', () => {
  assert.equal(
    workflowStatusForPolledOrder({ status: 'PENDING_ADDRESS_CHANGE' }, 'PENDING'),
    'PENDING_ADDRESS_CHANGE'
  );
  assert.equal(
    workflowStatusForPolledOrder({ status: 'REJECTED_BLOCKED_CUSTOMER' }, 'PENDING'),
    'REJECTED_BLOCKED_CUSTOMER'
  );
});
