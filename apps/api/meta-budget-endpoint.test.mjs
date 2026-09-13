import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createOperationsServer } from './server.mjs';

const config = Object.freeze({ rateLimitPerMinute: 60, financeCacheTtlMs: 120_000,
  financeCacheStaleMs: 1_800_000, financeRefreshIntervalSeconds: 120,
  runMode: 'SHADOW_READ_ONLY', oauthIssuer: 'https://identity.test', oauthClientId: 'client', oauthAudience: 'audience' });

test('authenticated debug endpoints expose policy, latest simulation and history with zero writes', async (t) => {
  const calls = [];
  const repository = {
    metaBudgetSimulation: async (params) => { calls.push(['latest', params.get('limit')]); return {
      mode: 'SIMULATION_SHADOW_ONLY', safety_notice: 'SIMULATION - NO REAL CHANGES', campaigns: [] }; },
    metaBudgetHistory: async (params) => { calls.push(['history', params.get('campaign_id')]); return {
      mode: 'SIMULATION_SHADOW_ONLY', safety_notice: 'SIMULATION - NO REAL CHANGES', decisions: [] }; }
  };
  const server = createOperationsServer({ config, repository, authenticate: async () => ({ principal_hash: 'fixture' }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const options = { headers: { Authorization: 'Bearer fixture' } };
  const policy = await fetch(`${base}/api/operations/meta-budget/policy`, options).then((response) => response.json());
  const latest = await fetch(`${base}/api/operations/meta-budget/simulation?limit=12`, options).then((response) => response.json());
  const history = await fetch(`${base}/api/operations/meta-budget/history?campaign_id=1001`, options).then((response) => response.json());
  assert.equal(policy.data.policy_version, 'META_BUDGET_POLICY_V1');
  assert.equal(policy.data.live_enabled, false); assert.equal(policy.meta_budget_writes, 0);
  assert.equal(latest.data.safety_notice, 'SIMULATION - NO REAL CHANGES');
  assert.equal(history.data.safety_notice, 'SIMULATION - NO REAL CHANGES');
  assert.deepEqual(calls, [['latest', '12'], ['history', '1001']]);
  for (const payload of [policy, latest, history]) {
    assert.equal(payload.actions_executed, 0); assert.equal(payload.production_writes, 0);
    assert.equal(payload.meta_budget_writes, 0); assert.equal(payload.external_actions, 0);
  }
});

test('Meta budget debug endpoints keep the existing authentication boundary', async (t) => {
  const server = createOperationsServer({ config, repository: {}, authenticate: async () => {
    throw Object.assign(new Error('no'), { status: 401, code: 'UNAUTHORIZED' });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/operations/meta-budget/policy`);
  assert.equal(response.status, 401);
});
