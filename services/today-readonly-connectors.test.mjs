import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDayBounds } from '../packages/platform-core/src/business-day.mjs';
import {
  readChatbySignals,
  readDropeaOrdersToday,
  readGlsTrackingToday,
  readCurrentSystemDashboard,
  readShopifyOrdersToday
} from './today-readonly-connectors.mjs';

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
      return response({
        orders: [{
          id: 1,
          name: '#1',
          tags: 'paid, Dropea ID: 1234567',
          created_at: '2026-07-27T08:00:00.000Z'
        }]
      }, {
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
  assert.equal(result.orders[0].identity_references.includes('1234567'), true);
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

test('Dropea semantic POST is restricted to the read-only GraphQL query and exact identity', async () => {
  const calls = [];
  const bounds = businessDayBounds({ businessDate: '2026-07-27', timeZone: 'Europe/Madrid' });
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return response({
      data: {
        orders: {
          data: [{
            id: 1234,
            status: 'PREPARED',
            created_at: '2026-07-27T08:00:00.000Z',
            tracking_code: '999',
            tracking_url: 'https://mygls.gls-spain.es/e/999/28001/'
          }]
        }
      }
    });
  };
  const result = await readDropeaOrdersToday({
    apiKey: 'test-key',
    bounds,
    orders: [{ identity_key: 'SHOPIFY:1', identity_references: ['1234'] }],
    fetchImpl
  });
  assert.equal(result.status.complete, true);
  assert.equal(result.status.exact_matches, 1);
  assert.equal(result.orders[0].direct_dropea_read, true);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].url, 'https://api.dropea.com/graphql/dropshippers');
  assert.match(calls[0].body.query, /query TodayOrdersReadOnly/);
  assert.doesNotMatch(calls[0].body.query, /mutation/i);
});

test('GLS semantic POST only reads tracking and never includes an action field', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return response({
      found: {
        state: { code: 'DELIVERED' },
        tracking: [{ at: '2026-07-27T12:00:00', code: 'DELIVERED', description: 'Entregado' }]
      }
    });
  };
  const result = await readGlsTrackingToday({
    orders: [{
      identity_key: 'SHOPIFY:1',
      tracking_present: true,
      tracking_url_ephemeral: 'https://mygls.gls-spain.es/e/999/28001/'
    }],
    fetchImpl
  });
  assert.equal(result.status.complete, true);
  assert.equal(result.orders[0].direct_gls_read, true);
  assert.equal(result.orders[0].logistics_state, 'DELIVERED');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].url, 'https://api.consignee.gls-spain.es/api/v5/expeditions/find');
  assert.deepEqual(Object.keys(calls[0].body), ['find']);
  assert.equal(calls[0].options.headers['X-Signature'].length, 64);
});

test('current-system password is exchanged for an ephemeral session before the GET read', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', options });
    if (String(url).endsWith('/api/dashboard-login')) {
      return new Response('', {
        status: 303,
        headers: { location: '/dashboard', 'set-cookie': 'suleia_dashboard=test-session; HttpOnly' }
      });
    }
    return response({
      dashboard: {
        orders: [{ orderId: 'ORDER-1', raw: { delivery_status: '600000000' } }]
      }
    });
  };
  const result = await readCurrentSystemDashboard({
    dashboardPassword: 'test-password',
    fetchImpl
  });
  assert.equal(result.status.authenticated, true);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET']);
  assert.equal(calls[0].url, 'https://suleia-autoconfirm.onrender.com/api/dashboard-login');
  assert.match(calls[0].options.body, /^password=/);
  assert.equal(calls[1].options.headers.Cookie, 'suleia_dashboard=test-session');
  assert.equal(result.orders[0].logistics_state, 'UNKNOWN');
});
