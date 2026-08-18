import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createOperationsServer, loadOperationsConfig } from './server.mjs';
import { createOperationsAuth } from '../../packages/suleia-operations-mcp/src/operations/auth.mjs';
import { OperationsRepository } from '../../packages/suleia-operations-mcp/src/operations/repository.mjs';

const config = loadOperationsConfig({
  databaseUrl: 'postgres://fixture.invalid/db', oauthIssuer: 'https://identity.example.test/realms/suleia',
  oauthJwksUrl: 'https://identity.example.test/certs', oauthAudience: 'suleia-operations-center',
  rateLimitPerMinute: 60, privateDataKey: 'fixture-private-key-that-is-longer-than-thirty-two-characters'
});

test('Operations API exposes only authenticated GET reads and zero-action envelopes', async (t) => {
  const repository = {
    summary: async () => ({ orders: { total: 0 }, incidents: { pending: 0 }, connectors: [] }),
    financialSummary: async () => ({ exactness: 'ORDER_VALUE_ONLY', costs: { availability: 'PENDING_SOURCE' }, actions_executed: 0 }),
    listOrders: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    orderDetail: async () => null,
    listIncidents: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    incidentOverview: async () => ({ items: [], total: 0, limit: 25, offset: 0, summary: { pending: 0 } }),
    incidentDetail: async () => null,
    recordIncidentFeedback: async (_id, value) => ({ feedback_id: 1, feedback_type: value.feedbackType, reason_code: value.reasonCode, actions_executed: 0, production_writes: 0 })
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
  const version = await fetch(`${base}/version`).then((response) => response.json());
  assert.equal(typeof version.revision, 'string');
  assert.equal(typeof version.branch, 'string');
  assert.equal(version.production_writes, 0);
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
  const overview = await fetch(`${base}/api/operations/incidents/overview?scope=ACTIVE`, { headers: { Authorization: 'Bearer fixture' } });
  const overviewPayload = await overview.json();
  assert.equal(overview.status, 200);
  assert.equal(overviewPayload.data.summary.pending, 0);
  assert.equal(overviewPayload.production_writes, 0);
  const post = await fetch(`${base}/api/operations/summary`, { method: 'POST' });
  assert.equal(post.status, 405);
  const feedback = await fetch(`${base}/api/operations/incidents/issue-fixture/feedback`, {
    method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback_type: 'APPROVE', reason_code: 'ACCURATE', recommendation_code: 'VALIDATE_NEW_ADDRESS' })
  });
  const feedbackPayload = await feedback.json();
  assert.equal(feedback.status, 201);
  assert.equal(feedbackPayload.internal_feedback_writes, 1);
  assert.equal(feedbackPayload.production_writes, 0);
});

test('incident feedback is structured, parameterized and cannot trigger external actions', async () => {
  const calls = [];
  const client = { query: async (sql, values = []) => { calls.push({ sql, values }); return /INSERT INTO/.test(sql) ? { rows: [{ feedback_id: 7, actions_executed: 0, production_writes: 0 }] } : { rows: [] }; }, release() {} };
  const pool = { connect: async () => client, end: async () => {} };
  const repository = new OperationsRepository(null, { pool });
  const result = await repository.recordIncidentFeedback('issue-1', { feedbackType: 'CORRECT', reasonCode: 'WRONG_TYPE', recommendationCode: 'CLASSIFY_INCIDENT', principalHash: 'principal-hash' });
  assert.equal(calls[0].sql, 'BEGIN READ WRITE');
  assert.match(calls[1].sql, /decision_memory\.incident_recommendation_feedback/);
  assert.deepEqual(calls[1].values, ['issue-1', 'CLASSIFY_INCIDENT', 'CORRECT', 'WRONG_TYPE', 'principal-hash']);
  assert.equal(result.production_writes, 0);
  await assert.rejects(() => repository.recordIncidentFeedback('issue-1', { feedbackType: 'EXECUTE', reasonCode: 'OTHER', recommendationCode: 'X', principalHash: 'x' }), { code: 'INVALID_FEEDBACK' });
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

test('order categories are allowlisted and the queue exposes the Render signal projection', async () => {
  const calls = [];
  const pool = { query: async (sql, values = []) => { calls.push({ sql, values }); return { rows: [] }; }, end: async () => {} };
  const repository = new OperationsRepository(null, { pool });
  await repository.listOrders(new URLSearchParams({ lifecycle: 'PENDING', category: 'CONFIRM' }));
  assert.match(calls[0].sql, /latest_customer_intent='CONFIRM'/);
  assert.match(calls[0].sql, /operations_conversation_summaries/);
  assert.match(calls[0].sql, /customer_signal_confidence/);
  assert.match(calls[0].sql, /operations_private_order_display/);
  assert.equal(calls[0].values.includes('CONFIRM'), false);

  calls.length = 0;
  await repository.listOrders(new URLSearchParams({ lifecycle: 'PENDING', category: 'RESPONDED' }));
  assert.match(calls[0].sql, /customer_response_status='RESPONDED'/);
  assert.match(calls[0].sql, /customer_response_summary/);
  assert.match(calls[0].sql, /customer_signal_association/);

  calls.length = 0;
  await repository.listOrders(new URLSearchParams({ lifecycle: 'PENDING', category: 'NO_RESPONSE' }));
  assert.match(calls[0].sql, /customer_response_status='NO_RESPONSE'/);
});

test('repository exposes decrypted private display fields only and strips ciphertext', async () => {
  const crypto = await import('node:crypto');
  const privateDataKey = 'fixture-private-key-that-is-longer-than-thirty-two-characters';
  const encrypt = (value) => {
    const key = crypto.createHash('sha256').update(`suleia-private-v1|${privateDataKey}`).digest();
    const iv = Buffer.alloc(12, 3); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
  };
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-fixture', dropea_order_id: '1234', total_count: 1,
    external_order_id_ciphertext: encrypt({ value: '#2006' }),
    shipping_address_ciphertext: encrypt({ first_name: 'Cliente', last_name: 'Prueba' })
  }] }), end: async () => {} };
  const repository = new OperationsRepository(null, { pool, privateDataKey });
  const result = await repository.listOrders(new URLSearchParams());
  assert.equal(result.items[0].external_order_reference, '#2006');
  assert.equal(result.items[0].customer_name, 'Cliente Prueba');
  assert.equal('external_order_id_ciphertext' in result.items[0], false);
  assert.equal('shipping_address_ciphertext' in result.items[0], false);
});

test('order search is exact, parameterized and never interpolated into SQL', async () => {
  const calls = [];
  const pool = { query: async (sql, values = []) => { calls.push({ sql, values }); return { rows: [] }; }, end: async () => {} };
  const repository = new OperationsRepository(null, { pool });
  await repository.listOrders(new URLSearchParams({ q: "1357847' OR true --" }));
  assert.match(calls[0].sql, /canonical_order_id=\$1 OR dropea_order_id=\$1/);
  assert.doesNotMatch(calls[0].sql, /OR true/);
  assert.equal(calls[0].values[0], "1357847' OR true --");
});

test('incident active=false is applied and does not silently fall back to the active queue', async () => {
  const calls = [];
  const pool = { query: async (sql, values = []) => { calls.push({ sql, values }); return { rows: [] }; }, end: async () => {} };
  const repository = new OperationsRepository(null, { pool });
  await repository.listIncidents(new URLSearchParams({ scope: 'ALL', active: 'false' }));
  assert.match(calls[0].sql, /is_active=\$1::boolean/);
  assert.equal(calls[0].values[0], false);
  assert.doesNotMatch(calls[0].sql, /status='PENDING' AND is_active=true/);
});

test('incident overview returns table and counters from one materialized selection', async () => {
  const calls = [];
  const pool = { query: async (sql, values = []) => {
    calls.push({ sql, values });
    return { rows: [{ items: [{ canonical_issue_id: 'masked-issue' }], total: 1, summary: { pending: 1, high_risk: 0 } }] };
  }, end: async () => {} };
  const repository = new OperationsRepository(null, { pool });
  const result = await repository.incidentOverview(new URLSearchParams({ scope: 'ACTIVE', to: '2026-08-15', risk: 'HIGH' }));
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WITH selected AS MATERIALIZED/);
  assert.match(calls[0].sql, /effective_risk = \$1/);
  assert.match(calls[0].sql, /created_at < \(\(\$2::date \+ 1\)::timestamp AT TIME ZONE 'Europe\/Madrid'\)/);
  assert.match(calls[0].sql, /status='PENDING' AND is_active=true/);
  assert.match(calls[0].sql, /operational_response_status/);
  assert.match(calls[0].sql, /operational_freshness_status/);
  assert.match(calls[0].sql, /NO_CONVERSATION/);
  assert.equal(result.total, 1);
  assert.equal(result.summary.pending, 1);
  assert.equal(result.limit, 25);
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
