import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeLifecycleAudit, preparedTemplateRecoveryWaitMs } from './orders.mjs';

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

test('keeps Chatby-native delivery pending inside the grace window', () => {
  const previous = process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES;
  process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES = '10';
  try {
    const audit = nativeLifecycleAudit({
      order: { orderId: 'fixture-order' },
      templateName: 'dropea_pedido_nuevo_v1',
      referenceAt: '2026-08-31T10:00:00.000Z',
      nowMs: Date.parse('2026-08-31T10:09:59.000Z')
    });
    assert.equal(audit.status, 'native_pending');
    assert.equal(audit.overdue, false);
    assert.equal(audit.error, null);
  } finally {
    if (previous === undefined) delete process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES;
    else process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES = previous;
  }
});

test('raises an actionable failure when Chatby-native delivery is overdue', () => {
  const previous = process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES;
  process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES = '10';
  try {
    const audit = nativeLifecycleAudit({
      order: { orderId: 'fixture-order' },
      templateName: 'dropea_pedido_nuevo_v1',
      referenceAt: '2026-08-31T10:00:00.000Z',
      nowMs: Date.parse('2026-08-31T10:10:00.000Z')
    });
    assert.equal(audit.status, 'native_overdue');
    assert.equal(audit.overdue, true);
    assert.match(audit.error, /WAMID/);
  } finally {
    if (previous === undefined) delete process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES;
    else process.env.CHATBY_NATIVE_TEMPLATE_GRACE_MINUTES = previous;
  }
});
