import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichPendingOrder } from './operational-orders.mjs';

test('a Chatby outage keeps the V2 order visible and marks customer evidence as not verifiable', async () => {
  const order = {
    orderId: '900001',
    status: 'PENDING',
    customerName: 'Cliente de prueba',
    customerPhone: '+34600000000',
    orderAmount: 29.99,
    raw: {
      source: 'DROPEA_PUBLIC_API_V2',
      created_at: '2026-08-16T08:00:00Z',
      items: [{ title: 'Producto' }]
    }
  };

  const row = await enrichPendingOrder(order, null, null, new Map(), 'Chatby respondió 401');

  assert.equal(row.orderId, '900001');
  assert.equal(row.dropeaStatus, 'PENDING');
  assert.equal(row.customerSignalRaw, 'NOT_VERIFIABLE');
  assert.equal(row.agentIntent, 'NOT_VERIFIABLE');
  assert.equal(row.customerConfirmed, false);
  assert.equal(row.customerMessages, 0);
  assert.equal(row.agentConfidence, 0);
  assert.equal(row.chatbyStatus, 'Chatby no verificable');
  assert.match(row.liveSource, /Dropea V2/);
});
