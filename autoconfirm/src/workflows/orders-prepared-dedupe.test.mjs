import test from 'node:test';
import assert from 'node:assert/strict';
import { preparedTemplateRecoveryWaitMs } from './orders.mjs';

test('waits for the normal Chatby prepared flow before recovery sends', () => {
  const now = Date.parse('2026-07-19T10:02:00.000Z');
  const order = { raw: { updated_at: '2026-07-19T10:01:00.000Z' } };

  assert.equal(preparedTemplateRecoveryWaitMs(order, now, 120), 60_000);
});

test('allows recovery after the prepared-flow grace period', () => {
  const now = Date.parse('2026-07-19T10:03:01.000Z');
  const order = { raw: { updated_at: '2026-07-19T10:01:00.000Z' } };

  assert.equal(preparedTemplateRecoveryWaitMs(order, now, 120), 0);
});

test('does not delay legacy orders without a reliable update timestamp', () => {
  assert.equal(preparedTemplateRecoveryWaitMs({ orderId: '1306064' }, Date.now(), 120), 0);
});
