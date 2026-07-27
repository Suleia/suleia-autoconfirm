import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDayBounds } from '../packages/platform-core/src/business-day.mjs';
import { readChatbySignals, readShopifyOrdersToday } from './today-readonly-connectors.mjs';

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

test('Shopify GET pagination follows Link and keeps the exact created_at range', async () => {
  const calls = [];
  const bounds = businessDayBounds({ businessDate: '2026-07-27', timeZone: 'Europe/Madrid' });
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    if (calls.length === 1) {
      return response({ orders: [{ id: 1, name: '#1', created_at: '2026-07-27T08:00:00.000Z' }] }, {
        headers: {
          link: '<https://store.test/admin/api/2026-04/orders.json?page_info=next>; rel="next"'
        }
      });
    }
    return response({ orders: [{ id: 2, name: '#2', created_at: '2026-07-27T09:00:00.000Z' }] });
  };
  const result = await readShopifyOrdersToday({
    domain: 'store.test',
    token: 'test-token',
    bounds,
    fetchImpl
  });
  assert.equal(result.status.complete, true);
  assert.equal(result.status.page_count, 2);
  assert.equal(result.orders.length, 2);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET']);
  const first = new URL(calls[0].url);
  assert.equal(first.searchParams.get('created_at_min'), bounds.utc_start);
  assert.equal(first.searchParams.get('created_at_max'), bounds.utc_end_exclusive);
});

test('Chatby association requires an exact order reference and never phone similarity', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/subscribers')) {
      return response({
        data: [{
          user_ns: 'masked-test-user',
          phone: '+34600000000',
          user_fields: [{ name: 'Dropea: Numero', value: 'ORDER-EXACT' }]
        }]
      });
    }
    return response({
      data: [{
        direction: 'inbound',
        created_at: '2026-07-27T09:00:00.000Z',
        text: 'Confirmo mi pedido'
      }]
    });
  };
  const result = await readChatbySignals({
    token: 'test-token',
    orders: [{
      identity_key: 'SHOPIFY:1',
      identity_references: ['ORDER-EXACT'],
      created_at: '2026-07-27T08:00:00.000Z',
      raw_ephemeral: { phone: '+34999999999' }
    }],
    maxPages: 5,
    fetchImpl
  });
  assert.equal(result.status.complete, true);
  assert.equal(result.orders[0].chatby_signal.intent, 'CONFIRM');
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET']);
});
