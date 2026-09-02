import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectPendingDropeaV2Incidents,
  createDropeaV2IncidentClient,
  DROPEA_V2_READ_SCOPES,
  normalizeDropeaV2Incident
} from './dropea-v2-incidents.mjs';

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
      jwt_expires_at: '2027-08-04T16:53:51.000Z',
      migration_cutover_at: '2026-08-03T00:00:00Z',
      native_v2_activation_at: '2026-08-04T00:00:00Z',
      historical_reingestion_allowed: true
    }])
  };
}

const order = {
  id: 41,
  status: 'SHIPPING',
  sub_status: 'DELIVERY_EXCEPTION',
  total_amount: 29.95,
  currency: 'EUR',
  carrier: 'GLS',
  service_type: '74',
  shipping_address: {
    full_name: 'Cliente de prueba',
    phone_number: '+34600000000',
    email: 'masked@example.invalid',
    address_line_1: 'Calle de prueba',
    city: 'Madrid',
    postal_code: '28000',
    country: 'ES'
  },
  line_items: [{ product_id: 2, variant_id: 3, product_name: 'Producto', quantity: 1, unit_price: 29.95 }],
  tracking_number: 'TRACK-MASKED',
  tracking_url: 'https://tracking.invalid/masked',
  created_at: '2026-08-08T09:00:00Z'
};

function issue(id, values = {}) {
  return {
    id,
    order_id: 41,
    type: 'RECIPIENT_ABSENT',
    status: 'PENDING',
    is_active: true,
    carrier: 'GLS',
    initial_carrier_code: 'AS',
    initial_carrier_description: 'Destinatario ausente',
    created_at: '2026-08-08T10:00:00Z',
    ...values
  };
}

test('Dropea V2 incident adapter uses pending-only GET reads and deduplicates getOrder', async () => {
  const calls = [];
  const fakeClient = {
    market: 'ES',
    async listAll(name, params, options) {
      calls.push({ method: 'GET', name, params, options });
      return {
        items: [issue(9), issue(9), issue(10), issue(11, { is_active: false })],
        complete: true
      };
    },
    async request(name, params) {
      calls.push({ method: 'GET', name, params });
      return { success: true, message: 'ok', data: order };
    }
  };

  const rows = await collectPendingDropeaV2Incidents({
    env: envFor(),
    clientFactory: () => fakeClient
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(calls.map(({ name }) => name), ['listIssues', 'getOrder']);
  assert.deepEqual(calls[0].params, { only_pending_to_resolve: true });
  assert.equal(calls[0].options.maxPages, 30);
  assert.deepEqual(calls[1].params, { id: 41 });
  assert.equal(calls.every(({ method }) => method === 'GET'), true);
  assert.equal(rows[0].order.orderId, '41');
  assert.equal(rows[0].order.customerPhone, '+34600000000');
  assert.equal(rows[0].issue.incidence_code, 'AS');
  assert.equal(rows[0].issue.raw.source, 'DROPEA_PUBLIC_API_V2');
});

test('Dropea V2 incident adapter rejects a token with any write scope before creating a client', async () => {
  let clientCreated = false;
  await assert.rejects(
    collectPendingDropeaV2Incidents({
      env: envFor(token([...DROPEA_V2_READ_SCOPES, 'dp:orders:confirm'])),
      clientFactory: () => {
        clientCreated = true;
        return {};
      }
    }),
    (error) => error?.code === 'DROPEA_WRITE_OR_UNKNOWN_SCOPE_BLOCKED'
  );
  assert.equal(clientCreated, false);
});

test('encapsulated V2 client emits GET-only requests to the official market host', async () => {
  const calls = [];
  const client = createDropeaV2IncidentClient({
    token: token(),
    market: 'ES',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            message: 'ok',
            data: { items: [], pagination: { total: 0, page: 1, limit: 100, total_pages: 0 } }
          };
        }
      };
    }
  });
  await client.listAll('listIssues', { only_pending_to_resolve: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.match(calls[0].url, /^https:\/\/es\.public-api\.dropea\.com\/dropshipper\/issues\?/);
  assert.match(calls[0].url, /only_pending_to_resolve=true/);
});

test('Dropea V2 normalization preserves the dashboard shape without creating actions', () => {
  const row = normalizeDropeaV2Incident(issue(9), order, { market: 'ES' });
  assert.equal(row.order.raw.customer.full_name, 'Cliente de prueba');
  assert.equal(row.order.raw.items[0].title, 'Producto');
  assert.equal(row.issue.status, 'PENDING');
  assert.equal(row.issue.description, 'Destinatario ausente');
  assert.equal(row.issue.tracking, 'TRACK-MASKED');
});

test('dashboard workflow keeps Dropea V2 writes blocked while allowing the gated Chatby incident sequence', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(here, '../workflows/incidents.mjs'), 'utf8');
  assert.match(source, /collectPendingDropeaV2Incidents/);
  assert.doesNotMatch(source, /listDropeaIncidences|listDropeaOrdersByStatus\(/);
  assert.match(source, /processIncidentNotification/);
  assert.match(source, /rejectedGoodsCommunicationEnabled/);
  assert.match(source, /incidentDiscountRealEnabled === true/);
  assert.match(source, /status: 'BLOCKED_READ_ONLY'/);
  assert.match(source, /reason: 'dropea_v2_dashboard_read_only'/);
  assert.match(source, /executeIncorrectAddressResolution/);
  assert.match(source, /incidentAddressResolutionRealEnabled/);
  assert.equal((source.match(/executeIncidentOperationalDecision\(/g) || []).length, 1);
});
