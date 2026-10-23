import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'suleia-text-delay-'));
process.env.ORDERS_PATH = path.join(temp, 'orders.json');
process.env.STATE_PATH = path.join(temp, 'state.json');
process.env.STORE_CONFIG_PATH = path.join(temp, 'stores.json');
process.env.SUPABASE_ENABLED = 'false';
process.env.GOOGLE_SHEETS_ENABLED = 'false';
const { processDelayedConfirmation, scheduleDelayedConfirmation } = await import('../src/workflows/orders.mjs');
const { findOrder } = await import('../src/storage.mjs');
after(() => fs.rmSync(temp, { recursive: true, force: true }));

const store = { id: 'fixture', agentDryRun: false, delayedConfirmRealEnabled: true, confirmationDelayHours: 1 };
const now = Date.now();
const signalAt = new Date(now - 2 * 3600000).toISOString();
const order = {
  orderId: '900001', status: 'PENDING', chatbyUserNs: 'fixture-conversation',
  raw: { created_at: new Date(now - 3 * 3600000).toISOString() },
  aiIntent: 'CONFIRM_DELAY_PENDING', confirmationSource: 'customer_text',
  confirmationDelayStartedAt: signalAt, confirmationDueAt: new Date(now - 3600000).toISOString()
};
const incoming = (content, at = signalAt) => ({ role: 'customer', content, raw: { type: 'in', ts: Date.parse(at) / 1000 } });

function fixture({ fresh = 'Deseo recibirlo', remoteStatus = 'PENDING', subscriberOrder = order.orderId, failRead = false, duplicate = null } = {}) {
  const events = [];
  return { events, dependencies: {
    duplicateGuard: async () => { events.push('duplicate'); return duplicate; },
    resolveSubscriber: async () => { events.push('identity'); return { user_fields: [{ name: 'Dropea: Numero', value: subscriberOrder }] }; },
    readOrder: async () => { events.push('order'); return { ...order, status: remoteStatus }; },
    readMessages: async () => { events.push('messages'); if (failRead) throw new Error('fixture read unavailable'); return [{ type: 'in', content: fresh, ts: (now - 60000) / 1000 }]; },
    confirmOrder: async id => { events.push(`confirm:${id}`); return { order_id: Number(id), accepted: true }; },
    cancelOrder: async id => { events.push(`cancel:${id}`); return { order_id: Number(id), accepted: true }; },
    verifyConfirmation: async () => { events.push('verify'); return { verified: true }; }
  } };
}

test('text consent starts the same full one-hour timer', async () => {
  const at = new Date(now - 10 * 60000).toISOString();
  const result = await scheduleDelayedConfirmation({ ...order, aiIntent: null }, store, { intent: 'CONFIRM', confidence: 100 }, 'customer_text', at, [incoming('Quiero recibirlo', at)]);
  assert.equal(result.action, 'confirmation_scheduled');
  assert.equal(Date.parse(result.dueAt) - Date.parse(at), 3600000);
  assert.equal(findOrder(store.id, order.orderId).confirmationSource, 'customer_text');
});

test('no provider or customer write before the hour has elapsed', async () => {
  const f = fixture();
  const result = await processDelayedConfirmation({ ...order, confirmationDueAt: new Date(now + 60000).toISOString() }, store, [incoming('Quiero recibirlo')], f);
  assert.equal(result.reason, 'confirmation_delay_waiting');
  assert.deepEqual(f.events, []);
});

test('due text consent uses exact identity, fresh order, fresh chat and postcondition verification', async () => {
  const f = fixture();
  const result = await processDelayedConfirmation(order, store, [incoming('Quiero recibirlo')], f);
  assert.equal(result.action, 'confirmed_after_delay');
  assert.deepEqual(f.events, ['duplicate', 'identity', 'order', 'messages', 'confirm:900001', 'verify']);
});

test('a newly arrived cancellation on the final read prevents confirmation', async () => {
  const f = fixture({ fresh: 'Ya no lo quiero' });
  const result = await processDelayedConfirmation(order, store, [incoming('Quiero recibirlo')], f);
  assert.equal(result.action, 'rejected_after_confirmation_cancel');
  assert.ok(f.events.includes('cancel:900001'));
  assert.ok(!f.events.includes('confirm:900001'));
});

for (const fresh of ['Lo quiero solo si llega mañana', 'Necesito cambiar la dirección', 'Espera, todavía no']) {
  test(`a final unresolved reply blocks provider confirmation: ${fresh}`, async () => {
    const f = fixture({ fresh });
    const result = await processDelayedConfirmation(order, store, [incoming('Quiero recibirlo')], f);
    assert.ok(['confirmation_review_required', 'hold_after_confirmation_address_change'].includes(result.action));
    assert.ok(!f.events.some(e => /^(confirm|cancel):/.test(e)));
  });
}

test('an unavailable final conversation never permits a write', async () => {
  const f = fixture({ failRead: true });
  await assert.rejects(processDelayedConfirmation(order, store, [incoming('Quiero recibirlo')], f), /read unavailable/);
  assert.ok(!f.events.some(e => /^(confirm|cancel):/.test(e)));
});

test('a missing confirmation in the complete final history blocks a stored decision', async () => {
  const f = fixture({ fresh: 'Hola' });
  const result = await processDelayedConfirmation(order, store, [incoming('Quiero recibirlo')], f);
  assert.equal(result.action, 'confirmation_review_required');
  assert.ok(!f.events.some(e => /^(confirm|cancel):/.test(e)));
});

test('a rematched subscriber or nonpending provider order prevents another confirmation', async () => {
  for (const options of [{ subscriberOrder: '900002' }, { remoteStatus: 'TRANSIT' }]) {
    const f = fixture(options);
    await processDelayedConfirmation(order, store, [incoming('Quiero recibirlo')], f);
    assert.ok(!f.events.some(e => /^(confirm|cancel):/.test(e)));
  }
});

test('existing duplicate guard and disabled real confirmations remain effective', async () => {
  const duplicate = fixture({ duplicate: { skipped: true, reason: 'duplicate_block' } });
  assert.equal((await processDelayedConfirmation(order, store, [incoming('Quiero recibirlo')], duplicate)).reason, 'duplicate_block');
  assert.deepEqual(duplicate.events, ['duplicate']);
  const disabled = fixture();
  assert.equal((await processDelayedConfirmation(order, { ...store, delayedConfirmRealEnabled: false }, [incoming('Quiero recibirlo')], disabled)).action, 'would_confirm_after_delay');
  assert.deepEqual(disabled.events, ['duplicate']);
});
