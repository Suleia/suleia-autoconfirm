import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suleia-storage-'));
process.env.ORDERS_PATH = path.join(testDir, 'orders.json');
process.env.SUPABASE_ENABLED = 'false';

const { upsertOrder } = await import('./storage.mjs');

test('preserva el temporizador de confirmacion en sincronizaciones posteriores', () => {
  const startedAt = '2026-07-18T12:00:00.000Z';
  const dueAt = '2026-07-18T13:00:00.000Z';

  upsertOrder('suleia', {
    orderId: '1305182',
    status: 'PENDING',
    aiIntent: 'CONFIRM_DELAY_PENDING',
    aiConfidence: 100,
    confirmationDelayStartedAt: startedAt,
    confirmationDueAt: dueAt,
    confirmationSource: 'customer_confirmation'
  });

  const updated = upsertOrder('suleia', {
    orderId: '1305182',
    status: 'PENDING',
    customerName: 'Cliente de prueba'
  });

  assert.equal(updated.aiIntent, 'CONFIRM_DELAY_PENDING');
  assert.equal(updated.aiConfidence, 100);
  assert.equal(updated.confirmationDelayStartedAt, startedAt);
  assert.equal(updated.confirmationDueAt, dueAt);
  assert.equal(updated.confirmationSource, 'customer_confirmation');
});

test.after(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});
