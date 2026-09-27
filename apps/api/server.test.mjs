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
    saveFixedExpense: async (_id, value) => ({ expense_id: '11111111-1111-4111-8111-111111111111', label: value.label, amount: value.amount, external_actions: 0 }),
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
  const fixedExpense = await fetch(`${base}/api/operations/finance/fixed-expenses`, {
    method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Gestoría', category: 'GESTORIA', expense_type: 'RECURRING', amount: 25, start_date: '2026-08-01', status: 'ACTIVE' })
  });
  const fixedPayload = await fixedExpense.json();
  assert.equal(fixedExpense.status, 201);
  assert.equal(fixedPayload.internal_configuration_writes, 1);
  assert.equal(fixedPayload.external_writes, 0);
});

test('Operations finance endpoint composes Render finance inputs with the canonical Operations event model', async (t) => {
  const calls = [];
  const repository = { financialSummary: async (_params, reports) => {
    calls.push(['canonical', reports.length]);
    return { period: { month: '2026-07' }, totals: { exactNetProfit: 1500 }, source: 'operations_canonical_finance_v3', productionWrites: 0 };
  } };
  const financeReportClient = {
    getMonthlyBundle: async (month) => { calls.push(['read', month]); return [{ period: { month }, totals: { exactNetProfit: 1558.99 }, source: 'render_finance_read_model', productionWrites: 0 }]; },
    addExpense: async (body) => { calls.push(['expense', body]); return { id: 'custom-fixture', name: body.name, external_actions: 0 }; }
  };
  const server = createOperationsServer({ config, repository, financeReportClient, authenticate: async () => ({ principal_hash: 'fixture-principal' }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const finance = await fetch(`${base}/api/operations/finance?month=2026-07`, { headers: { Authorization: 'Bearer fixture' } }).then((response) => response.json());
  assert.equal(finance.data.totals.exactNetProfit, 1500);
  assert.equal(finance.data.source, 'operations_canonical_finance_v3');
  const expense = await fetch(`${base}/api/operations/finance/fixed-expenses`, { method: 'POST', headers: { Authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Servidor', amount: '13.13', type: 'recurring_monthly', startDate: '2026-07-01' }) }).then((response) => response.json());
  const reloaded = await fetch(`${base}/api/operations/finance?month=2026-07`, { headers: { Authorization: 'Bearer fixture' } }).then((response) => response.json());
  assert.equal(expense.data.id, 'custom-fixture');
  assert.equal(reloaded.data.totals.exactNetProfit, 1500);
  assert.deepEqual(calls.map((call) => call[0]), ['read', 'canonical', 'expense', 'read', 'canonical']);
  assert.equal(expense.production_writes, 0);
  assert.equal(expense.external_writes, 0);
});

test('Operations finance endpoint coalesces concurrent reads, caches the report and degrades safely without the supplemental source', async (t) => {
  let canonicalReads = 0; let supplementalReads = 0; const events = [];
  const repository = { financialSummary: async (_params, reports) => {
    canonicalReads += 1; assert.equal(reports.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { period: { month: '2026-09' }, totals: { exactNetProfit: 42 }, warnings: [], source: 'operations_canonical_finance_v3' };
  } };
  const financeReportClient = { getMonthlyBundle: async () => { supplementalReads += 1; throw new Error('finance_report_http_503'); } };
  const server = createOperationsServer({ config, repository, financeReportClient,
    authenticate: async () => ({ principal_hash: 'fixture-principal' }), audit: (event) => events.push(event) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`; const options = { headers: { Authorization: 'Bearer fixture' } };
  const [first, second] = await Promise.all([
    fetch(`${base}/api/operations/finance?month=2026-09`, options).then((response) => response.json()),
    fetch(`${base}/api/operations/finance?month=2026-09`, options).then((response) => response.json())
  ]);
  const cached = await fetch(`${base}/api/operations/finance?month=2026-09`, options).then((response) => response.json());
  assert.equal(first.data.totals.exactNetProfit, 42);
  assert.equal(second.data.totals.exactNetProfit, 42);
  assert.equal(cached.data.totals.exactNetProfit, 42);
  assert.equal(canonicalReads, 1);
  assert.equal(supplementalReads, 1);
  assert.equal(events.some((event) => event.event === 'finance_supplemental_read_failed'), true);
  assert.equal(events.some((event) => event.event === 'finance_report_generated'), true);
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

const incidentFixture={canonical_issue_id:'masked-issue',canonical_order_id:'masked-order',dropea_issue_id:'test-issue',created_at:'2026-08-10T10:00:00Z',updated_at:'2026-08-10T11:00:00Z',status:'PENDING',is_active:true,effective_risk:'HIGH',interpreted_type:'REFUSED_BY_RECIPIENT'};
test('incident active=false is applied and never silently falls back to the active queue', async () => {
  const calls=[];const pool={query:async(sql,values=[])=>{calls.push({sql,values});return {rows:sql.includes('SELECT DISTINCT')?[]:[incidentFixture,{...incidentFixture,canonical_issue_id:'inactive',is_active:false,status:'RESOLVED'}]};}};
  const repository=new OperationsRepository(null,{pool});
  const result=await repository.listIncidents(new URLSearchParams({scope:'ALL',active:'false'}));
  assert.equal(result.total,1);assert.equal(result.items[0].canonical_issue_id,'inactive');
  assert.match(calls[0].sql,/m\.canonical_issue_id=p\.canonical_issue_id AND m\.canonical_order_id=p\.canonical_order_id/);
  assert.match(calls[0].sql,/m\.occurred_at>p\.created_at AND m\.occurred_at<=now\(\)/);
  assert.doesNotMatch(calls[0].sql,/m\.intent<>'UNKNOWN'/);
});
test('incident overview returns table and counters from one complete canonical universe',async()=>{
  const calls=[];const pool={query:async(sql,values=[])=>{calls.push({sql,values});return {rows:sql.includes('SELECT DISTINCT')?[{month:'2026-08'}]:[incidentFixture,{...incidentFixture,canonical_issue_id:'other',effective_risk:'LOW'}]};}};
  const repository=new OperationsRepository(null,{pool});
  const result=await repository.incidentOverview(new URLSearchParams({scope:'ACTIVE',to:'2026-08-15',risk:'HIGH',month:'2026-08',recovery:'PENDING'}));
  assert.equal(calls.length,6);assert.deepEqual(calls[0].values,['2026-08']);
  assert.match(calls[0].sql,/status='PENDING' AND is_active=true/);
  assert.match(calls[3].sql,/SELECT status,is_active,type,raw_type,dashboard_source_context/);
  assert.match(calls[2].sql,/operations_connector_health/);
  assert.match(calls[0].sql,/AT TIME ZONE 'Europe\/Madrid'/);
  assert.doesNotMatch(calls[0].sql,/incident\s+.*LIMIT/); // universe has no pagination before canonical selection
  assert.equal(result.total,1);assert.equal(result.summary.kpis.find(k=>k.key==='PENDING').count,result.total);
  assert.equal(result.summary.universe_count,1);assert.equal(result.limit,25);
  assert.equal(result.actions_executed,0);assert.equal(result.customer_messages_sent,0);
});
test('discount filter is exact and injection-like values cannot expand the derived universe',async()=>{
  const calls=[];const row={...incidentFixture,discount_signal_quality:'VERIFIED',discount_delivery_verified:true,discount_recovery_response_status:'DISCOUNT_ACCEPTED',discount_sent_at:'2026-08-10T11:00:00Z',discount_responded_at:'2026-08-10T12:00:00Z'};
  const pool={query:async(sql,values=[])=>{calls.push({sql,values});return {rows:sql.includes('SELECT DISTINCT')?[]:[row]};}};
  const repository=new OperationsRepository(null,{pool});
  const good=await repository.listIncidents(new URLSearchParams({scope:'ACTIVE',discount_response:'DISCOUNT_ACCEPTED'}));
  assert.equal(good.total,1);assert.match(calls[0].sql,/operations_incident_discount_recovery_latest/);
  const bad=await repository.listIncidents(new URLSearchParams({scope:'ACTIVE',discount_response:"DISCOUNT_ACCEPTED' OR true --"}));
  assert.equal(bad.total,0);assert.ok(calls.every(c=>!c.sql.includes('OR true')));
});

test('monthly financial summary is GET-only and missing sources remain unknown', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.includes('finance_available_months')) return { rows: [{ month: '2026-08' }] };
      return { rows: [] };
    },
    end: async () => {}
  };
  const repository = new OperationsRepository(null, { pool });
  const result = await repository.financialSummary(new URLSearchParams({ month: '2026-08' }));
  assert.equal(result.period.month, '2026-08');
  assert.equal(result.totals.metaSpend, null);
  assert.equal(result.totals.totalCosts, null);
  assert.equal(result.totals.exactNetProfit, null);
  assert.equal(result.totals.roiPercent, null);
  assert.equal(result.production_writes, 0);
  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /read_models\.operations_finance_order_inputs/);
  assert.doesNotMatch(calls[0].sql, /operations_order_context/);
  assert.match(calls[5].sql, /read_models\.operations_finance_order_inputs/);
  assert.equal(calls.every(({ sql }) => /^SELECT\b/i.test(sql.trim())), true);
  assert.equal(calls.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE|UPSERT|CALL)\b/i.test(sql)), true);
  assert.deepEqual(calls.map(({ values }) => values.length), [1, 1, 1, 1, 1, 1]);
});

test('fixed expenses are validated, parameterized, audited and never delete or call a provider', async () => {
  const calls = [];
  const row = { expense_id: '11111111-1111-4111-8111-111111111111', store_id: 'store-fixture', label: 'Gestoría',
    category: 'GESTORIA', expense_type: 'RECURRING', amount: 25, currency: 'EUR', start_date: '2026-08-01',
    end_date: null, occurred_on: null, status: 'ACTIVE', source: 'OPERATIONS_CENTER_USER', updated_at: new Date('2026-08-29T10:00:00Z') };
  const client = { query: async (sql, values = []) => { calls.push({ sql, values }); return /(?:INSERT INTO|UPDATE) economics\.finance_fixed_expenses/.test(sql) ? { rows: [row] } : { rows: [] }; }, release() {} };
  const repository = new OperationsRepository(null, { pool: { connect: async () => client, end: async () => {} } });
  const result = await repository.saveFixedExpense(null, { label: 'Gestoría', category: 'GESTORIA', expense_type: 'RECURRING', amount: 25, start_date: '2026-08-01', status: 'ACTIVE' }, 'principal-hash-fixture');
  assert.equal(calls[0].sql, 'BEGIN READ WRITE');
  assert.match(calls[1].sql, /economics\.finance_fixed_expenses/);
  assert.match(calls[2].sql, /economics\.finance_fixed_expense_audit/);
  assert.equal(calls.some(({ sql }) => /\bDELETE\b|https?:\/\//i.test(sql)), false);
  assert.equal(result.external_actions, 0);
  await assert.rejects(() => repository.saveFixedExpense(null, { label: 'x', expense_type: 'RECURRING', amount: -1, start_date: 'bad' }, 'principal-hash-fixture'), { code: 'INVALID_FIXED_EXPENSE' });
  await assert.rejects(() => repository.saveFixedExpense(null, { label: 'Gestoría', expense_type: 'RECURRING', amount: 25, start_date: '2026-02-31' }, 'principal-hash-fixture'), { code: 'INVALID_FIXED_EXPENSE' });
});
