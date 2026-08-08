import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createOperationsServer, loadOperationsConfig } from './server.mjs';
import { createOperationsAuth } from '../../packages/suleia-operations-mcp/src/operations/auth.mjs';
import { OperationsRepository } from '../../packages/suleia-operations-mcp/src/operations/repository.mjs';

const config = loadOperationsConfig({
  databaseUrl: 'postgres://fixture.invalid/db', oauthIssuer: 'https://identity.example.test/realms/suleia',
  oauthJwksUrl: 'https://identity.example.test/certs', oauthAudience: 'suleia-operations-center',
  rateLimitPerMinute: 60
});

test('Operations API exposes only authenticated GET reads and zero-action envelopes', async (t) => {
  const repository = {
    summary: async () => ({ orders: { total: 0 }, incidents: { pending: 0 }, connectors: [] }),
    financialSummary: async () => ({ exactness: 'ORDER_VALUE_ONLY', costs: { availability: 'PENDING_SOURCE' }, actions_executed: 0 }),
    listOrders: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    orderDetail: async () => null,
    listIncidents: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    incidentDetail: async () => null
  };
  const server = createOperationsServer({
    config,
    repository,
    authenticate: async (req) => {
      if (req.headers.authorization !== 'Bearer fixture') throw Object.assign(new Error('blocked'), { status: 401 });
      return { principal_hash: 'fixture-principal-hash' };
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.equal(health.actions_executed, 0);
  const unauthorized = await fetch(`${base}/api/operations/summary`);
  assert.equal(unauthorized.status, 401);
  const allowed = await fetch(`${base}/api/operations/summary`, { headers: { Authorization: 'Bearer fixture' } });
  const payload = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(payload.production_writes, 0);
  const finance = await fetch(`${base}/api/operations/finance?period=30d`, { headers: { Authorization: 'Bearer fixture' } });
  const financePayload = await finance.json();
  assert.equal(finance.status, 200);
  assert.equal(financePayload.data.costs.availability, 'PENDING_SOURCE');
  assert.equal(financePayload.production_writes, 0);
  const post = await fetch(`${base}/api/operations/summary`, { method: 'POST' });
  assert.equal(post.status, 405);
});

test('OAuth auth requires issuer/audience verification, role and read scope', async () => {
  const base = { headers: { authorization: 'Bearer fixture' } };
  const auth = createOperationsAuth({
    issuer: 'https://identity.example.test/realms/suleia', audience: 'suleia-operations-center',
    jwksUrl: 'https://identity.example.test/certs', requiredRole: 'operations_reader'
  }, {
    verify: async () => ({ payload: { sub: 'fixture-subject', exp: 9999999999, scope: 'openid operations:read', realm_access: { roles: ['operations_reader'] } } })
  });
  const result = await auth(base);
  assert.equal(result.scopes[0], 'operations:read');
  assert.notEqual(result.principal_hash, 'fixture-subject');
  const blocked = createOperationsAuth({
    issuer: 'https://identity.example.test/realms/suleia', audience: 'suleia-operations-center',
    jwksUrl: 'https://identity.example.test/certs', requiredRole: 'operations_reader'
  }, { verify: async () => ({ payload: { scope: 'openid', realm_access: { roles: [] } } }) });
  await assert.rejects(blocked(base), { code: 'INSUFFICIENT_SCOPE', status: 403 });
});

test('repository builds allowlisted filters and keeps user values parameterized', async () => {
  const calls = [];
  const pool = { query: async (sql, values = []) => { calls.push({ sql, values }); return { rows: [] }; }, end: async () => {} };
  const repository = new OperationsRepository(null, { pool });
  const query = new URLSearchParams({ status: "PENDING'; DROP TABLE x; --", ignored: 'blocked', limit: '500' });
  const result = await repository.listOrders(query);
  assert.equal(result.limit, 100);
  assert.doesNotMatch(calls[0].sql, /DROP TABLE/);
  assert.equal(calls[0].values[0], "PENDING'; DROP TABLE x; --");
  assert.equal(calls[0].sql.includes('ignored'), false);
});

test('financial summary is GET-only data with missing costs represented as unknown', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.includes('AS orders_total')) return { rows: [{ orders_total: 2, gross_order_value: '59.98', currency: 'EUR' }] };
      return { rows: [] };
    },
    end: async () => {}
  };
  const repository = new OperationsRepository(null, { pool });
  const result = await repository.financialSummary(new URLSearchParams({ period: 'UNTRUSTED' }));
  assert.equal(result.period, '30d');
  assert.equal(result.costs.total, null);
  assert.equal(result.profit, null);
  assert.equal(result.roi, null);
  assert.equal(result.production_writes, 0);
  assert.equal(calls.length, 3);
  assert.equal(calls.every(({ sql }) => /^SELECT\b/i.test(sql.trim())), true);
  assert.equal(calls.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE|UPSERT|CALL)\b/i.test(sql)), true);
  assert.equal(calls.every(({ values }) => values.length === 1), true);
});
