import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaBudgetDecisionRepository } from './repository.mjs';

function transactionPool(handler) {
  const calls = [];
  const client = { query: async (sql, values = []) => { calls.push({ sql, values }); return handler(sql, values); }, release() {} };
  return { pool: { connect: async () => client, query: client.query }, calls };
}

const decision = Object.freeze({ decisionId: '00000000-0000-4000-8000-000000000001',
  evaluationHour: '2026-09-13T05:00:00.000Z', campaignId: '1001', campaignName: 'Fixture',
  campaignStatus: 'ACTIVE', timezone: 'Europe/Madrid', localTime: '2026-09-13T07:00:00+02:00[Europe/Madrid]',
  budgetModel: 'CBO', budgetPeriod: 'DAILY', actualMetaBudgetCents: 1500, budgetBeforeCents: 1500,
  budgetProposedCents: 2500, budgetDeltaCents: 1000, purchaseRoas: '7.2',
  metricsWindow: { date_start: '2026-09-13', date_stop: '2026-09-13' }, metricsStatus: 'FRESH',
  policyVersion: 'META_BUDGET_POLICY_V1', decisionType: 'WOULD_CHANGE', reasonCode: 'WOULD_INCREASE',
  reasonText: 'fixture', mode: 'SIMULATION', wouldExecute: true,
  telegramPreviewPayload: { delivery: 'PREVIEW_ONLY', sent: false } });

test('repository persists only an internal decision and simulated state with zero external counters', async () => {
  const fixture = transactionPool(async (sql) => {
    if (sql.includes('INSERT INTO economics.meta_budget_decisions')) return { rows: [{ decision_id: decision.decisionId }] };
    return { rows: [] };
  });
  const repository = new MetaBudgetDecisionRepository(fixture.pool, { internalDatabaseWritesEnabled: true });
  const result = await repository.persistDecision(decision);
  assert.equal(result.inserted, true); assert.equal(result.metaBudgetWrites, 0); assert.equal(result.externalActions, 0);
  const insert = fixture.calls.find((call) => call.sql.includes('INSERT INTO economics.meta_budget_decisions'));
  assert.match(insert.sql, /false,false,\$23::jsonb,0,0,0/);
  assert.equal(fixture.calls.some((call) => /graph\.facebook/i.test(call.sql)), false);
});

test('repository blocks even internal persistence unless explicitly enabled', async () => {
  const fixture = transactionPool(async () => ({ rows: [] }));
  const repository = new MetaBudgetDecisionRepository(fixture.pool);
  await assert.rejects(() => repository.persistDecision(decision), /META_BUDGET_INTERNAL_DB_WRITES_DISABLED/);
  assert.equal(fixture.calls.length, 0);
});

test('simulation reset changes only internal state and writes a zero-action audit row', async () => {
  const fixture = transactionPool(async (sql) => sql.includes('RETURNING campaign_id') ? { rows: [{ campaign_id: '1001',
    actual_meta_budget_cents: '7100', simulated_budget_cents: '7100' }] } : { rows: [] });
  const repository = new MetaBudgetDecisionRepository(fixture.pool, { internalDatabaseWritesEnabled: true });
  const result = await repository.resetSimulationToMetaBudget({ campaignId: '1001',
    policyVersion: 'META_BUDGET_POLICY_V1', actualMetaBudgetCents: 7100 });
  assert.equal(result.production_writes, 0); assert.equal(result.meta_budget_writes, 0);
  assert.equal(fixture.calls.some((call) => call.sql.includes('meta_budget_simulation_resets')), true);
});
