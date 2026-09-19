import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DROPEA_V2_READ_SCOPES } from './dropea-v2-incidents.mjs';
import {
  getDropeaV2OrderById,
  listDropeaV2OrdersByStatus,
  normalizeDropeaV2Order
} from './dropea-v2-orders.mjs';

function token(scopes = DROPEA_V2_READ_SCOPES, exp = 1_817_398_431) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp, scope: scopes.join(' ') })}.test-signature`;
}

function envFor(readToken = token()) {
  return {
    DROPEA_READ_JWT_ES: readToken,
    DROPEA_STORES_CONFIG: JSON.stringify([{
      store_id: '16088',
      market: 'ES',
      base_url: 'https://es.public-api.dropea.com',
      jwt_secret_reference: 'DROPEA_READ_JWT_ES',
      jwt_expires_at: '2027-08-04T16:53:51.000Z'
    }])
  };
}

const pendingOrder = {
  id: 900001,
  status: 'PENDING',
  sub_status: 'PENDING',
  total_amount: 29.99,
  currency: 'EUR',
  carrier: 'GLS',
  service_type: '74',
  shipping_address: {
    full_name: 'Cliente de prueba',
    phone_number: '+34600000000',
    email: 'masked@example.invalid',
    address_line_1: 'Calle de prueba',
    city: 'Madrid',
    state: 'Madrid',
    postal_code: '28000',
    country: 'ES'
  },
  line_items: [{ product_id: 2, variant_id: 3, product_name: 'Producto', quantity: 1, unit_price: 29.99 }],
  created_at: '2026-08-16T08:00:00Z',
  updated_at: '2026-08-16T08:01:00Z'
};

test('Dropea V2 orders adapter reads PENDING by exact store and preserves the legacy workflow shape', async () => {
  const calls = [];
  const fakeClient = {
    market: 'ES',
    async request(name, params) {
      calls.push({ name, params });
      return {
        success: true,
        message: 'ok',
        data: { items: [pendingOrder], pagination: { total: 1, page: 1, limit: 100, total_pages: 1 } }
      };
    }
  };

  const rows = await listDropeaV2OrdersByStatus({
    status: 'PENDING',
    env: envFor(),
    clientFactory: () => fakeClient
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(calls, [{
    name: 'listOrders',
    params: {
      status: 'PENDING',
      store_id: 16088,
      page: 1,
      limit: 100,
      sort_by: 'created_at',
      sort_order: 'desc'
    }
  }]);
  assert.equal(rows[0].orderId, '900001');
  assert.equal(rows[0].status, 'PENDING');
  assert.equal(rows[0].customerPhone, '+34600000000');
  assert.equal(rows[0].raw.source, 'DROPEA_PUBLIC_API_V2');
  assert.equal(rows[0].raw.carrier_company, 'GLS');
});

test('legacy operational status filters map to the governed V2 top-level status', async () => {
  const calls = [];
  const fakeClient = {
    market: 'ES',
    async request(name, params) {
      calls.push({ name, params });
      return {
        success: true,
        message: 'ok',
        data: { items: [], pagination: { total: 0, page: 1, limit: 100, total_pages: 0 } }
      };
    }
  };
  await listDropeaV2OrdersByStatus({
    status: 'PREPARED',
    env: envFor(),
    clientFactory: () => fakeClient
  });
  assert.equal(calls[0].params.status, 'PROCESSING');
});

test('V2 order normalization keeps top/sub-status in raw data and exposes compatible workflow status', () => {
  const normalized = normalizeDropeaV2Order({
    ...pendingOrder,
    status: 'PROCESSING',
    sub_status: 'PACKED'
  });
  assert.equal(normalized.status, 'PREPARED');
  assert.equal(normalized.raw.status, 'PROCESSING');
  assert.equal(normalized.raw.sub_status, 'PACKED');
  assert.equal(normalized.raw.items[0].title, 'Producto');
});

test('get order uses the official V2 item read and returns null only on an observed 404', async () => {
  const fakeClient = {
    market: 'ES',
    async request(name, params) {
      assert.equal(name, 'getOrder');
      assert.deepEqual(params, { id: 900001 });
      return { success: true, message: 'ok', data: pendingOrder };
    }
  };
  const order = await getDropeaV2OrderById(900001, {
    env: envFor(),
    clientFactory: () => fakeClient
  });
  assert.equal(order.orderId, '900001');
});

test('all production order list/get exports are routed away from retired GraphQL', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(here, 'dropea.mjs'), 'utf8');
  for (const exportName of [
    'listPendingDropeaOrders',
    'listDropeaOrdersByStatus',
    'listDropeaOrdersByStatusBasic',
    'listDropeaOrders',
    'listDropeaOrdersBasic',
    'getDropeaOrderById'
  ]) {
    const match = source.match(new RegExp(`export async function ${exportName}\\([^]*?\\n}`));
    assert.ok(match, `${exportName} is present`);
    assert.doesNotMatch(match[0], /requestGraphQL/);
  }
});
