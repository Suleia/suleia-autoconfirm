import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATBY_NATIVE_CONTACT_LOOKUP_PAGES,
  chatbyNativeSubscriberPayload,
  initialTemplateIsTerminal,
  initialTemplateBlockedByLegacyOwnership,
  mergeLifecycleTemplateStateFromLedger,
  nativeLifecycleAudit,
  nativeLifecycleVerificationRequired,
  orderNeedsPreparedTemplate,
  preparedTemplateRecoveryWaitMs
} from './orders.mjs';

test('restores both lifecycle delivery states from the persistent ledger after restart', () => {
  const restored = mergeLifecycleTemplateStateFromLedger({
    orderId: 'fixture-order',
    chatbyTemplateSendStatus: 'native_pending',
    preparedTemplateSendStatus: 'native_pending'
  }, {
    initialTemplateName: 'es_ES dropea_pedido_nuevo_v1',
    preparedTemplateName: 'es_ES dropea_pedido_preparado_v1',
    initialDelivery: {
      status: 'sent',
      sent_at: '2026-09-06T10:01:00.000Z',
      attempted_at: '2026-09-06T10:00:59.000Z',
      chatby_user_ns: 'fixture-user'
    },
    preparedDelivery: {
      status: 'already_seen',
      sent_at: '2026-09-06T10:05:00.000Z',
      attempted_at: '2026-09-06T10:04:59.000Z',
      chatby_user_ns: 'fixture-user'
    }
  });

  assert.equal(restored.chatbyTemplateSendStatus, 'sent');
  assert.equal(restored.chatbyTemplateSentAt, '2026-09-06T10:01:00.000Z');
  assert.equal(restored.preparedTemplateSendStatus, 'already_seen');
  assert.equal(restored.preparedTemplateSentAt, '2026-09-06T10:05:00.000Z');
  assert.equal(restored.chatbyUserNs, 'fixture-user');
  assert.equal(restored.chatbyTemplateLastError, null);
  assert.equal(restored.preparedTemplateLastError, null);
});

test('does not trust failed or incomplete persistent delivery rows as sent', () => {
  const order = { orderId: 'fixture-order', chatbyTemplateSendStatus: 'native_pending' };
  const restored = mergeLifecycleTemplateStateFromLedger(order, {
    initialTemplateName: 'es_ES dropea_pedido_nuevo_v1',
    initialDelivery: {
      status: 'failed',
      sent_at: '2026-09-06T10:01:00.000Z'
    },
    preparedTemplateName: 'es_ES dropea_pedido_preparado_v1',
    preparedDelivery: {
      status: 'sent',
      sent_at: null
    }
  });

  assert.equal(restored, order);
});

test('bounds native contact lookup to the newest Chatby page before provisioning', () => {
  assert.equal(CHATBY_NATIVE_CONTACT_LOOKUP_PAGES, 1);
});

test('builds one complete native Chatby contact for the exact Dropea order', () => {
  const payload = chatbyNativeSubscriberPayload({
    orderId: '1396461',
    status: 'PENDING',
    customerName: 'Persona Fixture',
    customerPhone: '+34600000000',
    customerEmail: 'fixture@example.test',
    orderAmount: 29.99,
    currencyCode: 'EUR',
    createdAt: '2026-09-06T16:16:40.000Z',
    raw: {
      status: 'PENDING',
      sub_status: 'PENDING',
      payment_method: 'COD',
      line_items: [{ product_name: 'Producto Fixture', quantity: 1 }],
      shipping_address: {
        address_line_1: 'Calle Fixture 1',
        address_line_2: 'Puerta A',
        city: 'Ciudad Fixture',
        postal_code: '00000',
        state: 'Provincia Fixture',
        country: 'ES'
      }
    }
  }, { name: 'Suleia' });

  const fields = Object.fromEntries(payload.user_fields.map((field) => [field.name, field.value]));
  assert.equal(fields['#Pedido'], '1396461');
  assert.equal(fields['Precio Total'], '29.99');
  assert.equal(fields['Producto Principal'], 'Producto Fixture');
  assert.equal(fields['Dirección'], 'Calle Fixture 1');
  assert.equal(fields.event_status, 'PENDING:PENDING');
  assert.equal(fields['Método Pago'], 'COD');
  assert.equal(fields.Moneda, 'EUR');
  assert.equal(payload.address, 'Calle Fixture 1 Puerta A');
});

test('trusts only a persisted accepted initial template as terminal', () => {
  assert.equal(initialTemplateIsTerminal({
    chatbyTemplateName: 'es_ES dropea_pedido_nuevo_v1',
    chatbyTemplateSendStatus: 'already_seen',
    chatbyTemplateSentAt: '2026-09-06T18:00:00.000Z'
  }, 'es_ES dropea_pedido_nuevo_v1'), true);
  assert.equal(initialTemplateIsTerminal({
    chatbyTemplateName: 'es_ES dropea_pedido_nuevo_v1',
    chatbyTemplateSendStatus: 'native_pending',
    chatbyTemplateSentAt: null
  }, 'es_ES dropea_pedido_nuevo_v1'), false);
  assert.equal(initialTemplateIsTerminal({
    chatbyTemplateName: 'es_ES dropea_pedido_nuevo_v1',
    chatbyTemplateSendStatus: 'sent',
    chatbyTemplateSentAt: null
  }, 'es_ES dropea_pedido_nuevo_v1'), false);
});

test('recognizes every canonical and Dropea V2 prepared-order status', () => {
  for (const status of [
    'CONFIRMED', 'PROCESSING', 'PREPARING', 'IN_PREPARATION', 'PREPARED',
    'SHIPPING', 'TRANSIT', 'IN_TRANSIT', 'DELIVERED'
  ]) {
    assert.equal(orderNeedsPreparedTemplate({ status }), true, status);
  }
  for (const status of ['PENDING', 'CANCELLED', 'REJECTED', 'ERROR']) {
    assert.equal(orderNeedsPreparedTemplate({ status }), false, status);
  }
});

test('recognizes only the historical initial-template ownership failure', () => {
  assert.equal(initialTemplateBlockedByLegacyOwnership({
    chatbyTemplateSendStatus: 'failed',
    chatbyTemplateLastError: 'Lifecycle template blocked: Chatby native automation is the configured single sender.'
  }), true);
  assert.equal(initialTemplateBlockedByLegacyOwnership({
    chatbyTemplateSendStatus: 'persistent_failed',
    chatbyTemplateLastError: 'Lifecycle template blocked: Chatby native automation is the configured single sender.'
  }), true);
  assert.equal(initialTemplateBlockedByLegacyOwnership({
    chatbyTemplateSendStatus: 'failed',
    chatbyTemplateLastError: 'Chatby 401'
  }), false);
  assert.equal(initialTemplateBlockedByLegacyOwnership({
    chatbyTemplateSendStatus: 'sent',
    chatbyTemplateLastError: 'Lifecycle template blocked: Chatby native automation is the configured single sender.'
  }), false);
});

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

test('reads the prepared conversation only after the native grace window expires', () => {
  assert.equal(nativeLifecycleVerificationRequired({ status: 'native_pending', overdue: false }), false);
  assert.equal(nativeLifecycleVerificationRequired({ status: 'native_overdue', overdue: true }), true);
  assert.equal(nativeLifecycleVerificationRequired({}), false);
});
