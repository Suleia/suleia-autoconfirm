import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalOrderSignal, syncOperationalOrderSignals } from './operational-order-signal-sync.mjs';

test('maps the governed Render categories without conversation content', () => {
  const cases = [
    ['CONFIRM', 'CONFIRM'], ['NO_CONFIRM', 'REJECT'],
    ['ADDRESS_CHANGE_REQUESTED', 'ADDRESS_CHANGE'], ['NO_RESPONSE', 'NO_RESPONSE'],
    ['UNCLEAR', 'UNCLEAR']
  ];
  for (const [source, expected] of cases) {
    const signal = operationalOrderSignal({ agent_intent: source, customer_messages: source === 'NO_RESPONSE' ? 0 : 1, agent_confidence: 100, updated_at: '2026-08-16T19:00:00Z' }, 'order-1');
    assert.equal(signal.detected_intent, expected);
    assert.equal(signal.explanation_masked.association, 'EXACT_DROPEA_ORDER_ID');
    assert.equal(signal.explanation_masked.response_status, source === 'NO_RESPONSE' ? 'NO_RESPONSE' : 'RESPONDED');
    assert.equal(signal.actions_executed, 0);
    assert.equal(signal.production_writes, 0);
    assert.equal(JSON.stringify(signal).includes('message content'), false);
  }
});

test('keeps each order response distinct and never invents a reply timestamp', () => {
  const confirmed = operationalOrderSignal({
    agent_intent: 'CONFIRM', customer_messages: 1, agent_confidence: 100,
    updated_at: '2026-08-18T10:00:00Z', raw: { lastCustomerMessageAt: '2026-08-18T09:58:00Z' }
  }, 'order-confirmed');
  const unanswered = operationalOrderSignal({
    agent_intent: 'NO_RESPONSE', customer_messages: 0, agent_confidence: 25,
    updated_at: '2026-08-18T10:00:00Z'
  }, 'order-unanswered');

  assert.equal(confirmed.canonical_order_id, 'order-confirmed');
  assert.equal(confirmed.latest_inbound_message_at, '2026-08-18T09:58:00Z');
  assert.equal(confirmed.explanation_masked.response_summary, 'El cliente confirmó el pedido.');
  assert.equal(unanswered.canonical_order_id, 'order-unanswered');
  assert.equal(unanswered.latest_inbound_message_at, null);
  assert.equal(unanswered.explanation_masked.response_summary, 'No hay mensajes entrantes del cliente para este pedido.');
});

test('projects only signals matched to an exact Dropea store order', async () => {
  const projected = [];
  const source = { page: async () => ({ rows: [{ order_id: '101', agent_intent: 'CONFIRM', customer_messages: 1, updated_at: '2026-08-16T19:00:00Z' }], missing: false }) };
  const projector = {
    resolveCanonicalOrderByDropeaId: async ({ dropeaOrderId }) => dropeaOrderId === '101' ? { status: 'FOUND', canonical_order_id: 'canonical-101' } : { status: 'NOT_FOUND' },
    upsertOperationalOrderSignal: async (signal) => projected.push(signal)
  };
  const result = await syncOperationalOrderSignals({ source, projector, stores: [{ market: 'ES', store_id: '1' }], pageSize: 100 });
  assert.equal(result.projected, 1);
  assert.equal(projected[0].canonical_order_id, 'canonical-101');
  assert.equal(projected[0].detected_intent, 'CONFIRM');
});
