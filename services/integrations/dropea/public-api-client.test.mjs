import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED_READ_SCOPES,
  assertExactReadOnlyScopes,
  contractOperationMatrix,
  contractInventory,
  loadDropeaContract,
  marketHost
} from './contract.mjs';
import { createDropeaPublicApiClient } from './public-api-client.mjs';

function jwt(scopes = APPROVED_READ_SCOPES) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ scope: scopes.join(' ') })}.test-signature`;
}

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function page(items, pageNumber, totalPages) {
  return {
    success: true,
    message: 'ok',
    data: { items, pagination: { total: totalPages, page: pageNumber, limit: 1, total_pages: totalPages } },
    failure: null
  };
}

test('pinned OpenAPI checksum, version and all 25 operations are stable', () => {
  const { document, checksum } = loadDropeaContract();
  assert.equal(checksum, '80e6419cec28ecef6a0cfabc9733e549a152760ababbdb587a0c664873866315');
  assert.equal(document.openapi, '3.0.3');
  assert.equal(document.info.version, '0.1.0');
  const inventory = contractInventory(document);
  assert.equal(inventory.length, 25);
  assert.equal(inventory.filter((item) => item.method === 'GET').length, 15);
  assert.equal(inventory.filter((item) => item.method !== 'GET').length, 10);
});

test('operation matrix documents every capability while implementing GET only', () => {
  const matrix = contractOperationMatrix();
  assert.equal(matrix.length, 25);
  assert.equal(matrix.filter((operation) => operation.implemented).length, 15);
  assert.equal(matrix.filter((operation) => operation.method !== 'GET' && operation.implemented).length, 0);
  assert.equal(matrix.filter((operation) => operation.method !== 'GET').every((operation) => operation.suleia_mode === 'DOCUMENTED_NOT_IMPLEMENTED'), true);
  assert.equal(matrix.every((operation) => operation.verified_live === false), true);
});

test('read token must contain exactly the six approved scopes', () => {
  assert.deepEqual(assertExactReadOnlyScopes(jwt()), [...APPROVED_READ_SCOPES].sort());
  assert.throws(
    () => assertExactReadOnlyScopes(jwt([...APPROVED_READ_SCOPES, 'dp:orders:confirm'])),
    { code: 'DROPEA_WRITE_OR_UNKNOWN_SCOPE_BLOCKED' }
  );
  assert.throws(
    () => assertExactReadOnlyScopes(jwt(APPROVED_READ_SCOPES.slice(1))),
    { code: 'DROPEA_REQUIRED_READ_SCOPE_MISSING' }
  );
  assert.throws(() => assertExactReadOnlyScopes('opaque-token'), { code: 'DROPEA_TOKEN_NOT_INSPECTABLE' });
});

test('only the three official market hosts are accepted', () => {
  assert.equal(marketHost('es'), 'es.public-api.dropea.com');
  assert.equal(marketHost('IT'), 'it.public-api.dropea.com');
  assert.equal(marketHost('pt'), 'pt.public-api.dropea.com');
  assert.throws(() => marketHost('example.com'), { code: 'DROPEA_MARKET_NOT_APPROVED' });
});

test('client performs GET-only reads and encodes path and query parameters', async () => {
  const calls = [];
  const client = createDropeaPublicApiClient({
    token: jwt(),
    market: 'ES',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ success: true, message: 'ok', data: { id: 7 }, failure: null });
    }
  });
  const result = await client.request('getOrder', { id: 7 });
  assert.equal(result.data.id, 7);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].url, 'https://es.public-api.dropea.com/dropshipper/orders/7');
  await assert.rejects(client.request('getOrder', { id: 7, ignored_query: 'blocked' }), { code: 'DROPEA_PARAMETER_NOT_DECLARED' });
  await assert.rejects(client.request('confirmOrder', { id: 7 }), { code: 'DROPEA_OPERATION_BLOCKED' });
});

test('complete pagination follows contract metadata without repeating or skipping pages', async () => {
  const calls = [];
  const client = createDropeaPublicApiClient({
    token: jwt(),
    fetchImpl: async (url) => {
      const current = Number(new URL(url).searchParams.get('page'));
      calls.push(current);
      return response(page([{ id: current }], current, 3));
    }
  });
  const result = await client.listAll('listOrders', { limit: 1 });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(result.items.map((item) => item.id), [1, 2, 3]);
  assert.equal(result.complete, true);
});

test('429 honors Retry-After and retries without exposing response content', async () => {
  const waits = [];
  let attempt = 0;
  const client = createDropeaPublicApiClient({
    token: jwt(),
    wait: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) return response({ message: 'sensitive details' }, { status: 429, headers: { 'retry-after': '2' } });
      return response({ success: true, message: 'ok', data: { items: [] }, failure: null });
    }
  });
  await client.request('listWebhooks');
  assert.equal(attempt, 2);
  assert.deepEqual(waits, [2000]);
});

test('circuit breaker opens after bounded repeated read failures', async () => {
  const client = createDropeaPublicApiClient({
    token: jwt(),
    maxRetries: 0,
    circuitThreshold: 2,
    fetchImpl: async () => response({ message: 'failed' }, { status: 503 })
  });
  await assert.rejects(client.request('getMe'), { code: 'DROPEA_HTTP_503' });
  await assert.rejects(client.request('getMe'), { code: 'DROPEA_HTTP_503' });
  await assert.rejects(client.request('getMe'), { code: 'DROPEA_CIRCUIT_OPEN' });
});

test('invalid success and pagination envelopes fail closed', async () => {
  const badSuccess = createDropeaPublicApiClient({ token: jwt(), fetchImpl: async () => response({ data: {} }) });
  await assert.rejects(badSuccess.request('getMe'), { code: 'DROPEA_RESPONSE_SCHEMA_INVALID' });
  const badPage = createDropeaPublicApiClient({
    token: jwt(),
    fetchImpl: async () => response({ success: true, message: 'ok', data: { items: [] } })
  });
  await assert.rejects(badPage.request('listOrders'), { code: 'DROPEA_PAGINATION_SCHEMA_INVALID' });
});

test('contract preserves critical enums, required fields and nullable semantics', () => {
  const { document } = loadDropeaContract();
  const schemas = document.components.schemas;
  assert.deepEqual(schemas.Order.properties.status.enum, [
    'DRAFT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'FINISH', 'ERROR'
  ]);
  assert.equal(schemas.Order.properties.sub_status.nullable, true);
  assert.equal(schemas.Order.required.includes('line_items'), true);
  assert.deepEqual(schemas.Issue.properties.status.enum, ['INFO', 'PENDING', 'MANAGING_WITH_CLIENT', 'RESOLVED']);
  assert.equal(schemas.Issue.properties.resolution_status.nullable, true);
  assert.equal(schemas.Issue.required.includes('pickup_point'), true);
  assert.equal(schemas.OperationStatus.properties.completed_at.nullable, true);
  assert.equal(schemas.Pagination.required.includes('pagination'), true);
});

test('contract-driven parameter validation blocks unknown, invalid enum and out-of-range inputs', async () => {
  const client = createDropeaPublicApiClient({ token: jwt(), fetchImpl: async () => response(page([], 1, 1)) });
  await assert.rejects(client.request('listOrders', { unknown: true }), { code: 'DROPEA_PARAMETER_NOT_DECLARED' });
  await assert.rejects(client.request('listOrders', { status: 'NOT_REAL' }), { code: 'DROPEA_PARAMETER_SCHEMA_INVALID' });
  await assert.rejects(client.request('listOrders', { limit: 101 }), { code: 'DROPEA_PARAMETER_SCHEMA_INVALID' });
});
