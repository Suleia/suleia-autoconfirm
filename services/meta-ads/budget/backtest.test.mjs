import test from 'node:test';
import assert from 'node:assert/strict';
import { runMetaBudgetBacktest } from './backtest.mjs';
import { META_BUDGET_POLICY_V1 } from './policy.mjs';

const row = (evaluatedAt, roas, budget = 1500, campaignId = '1') => ({ campaignId, campaignName: 'Fixture',
  actualMetaBudgetCents: budget, purchaseRoas: roas, metricsStatus: 'FRESH', budgetModel: 'CBO',
  budgetPeriod: 'DAILY', campaignStatus: 'ACTIVE', currency: 'EUR', evaluatedAt });

test('backtest reports simulated decisions as non-causal and performs zero actions', () => {
  const result = runMetaBudgetBacktest({ policy: META_BUDGET_POLICY_V1, metrics: [
    row('2026-09-13T05:00:00Z', '7'), row('2026-09-13T06:00:00Z', '6'),
    row('2026-09-14T00:00:00Z', '9', 7000, '2')
  ] });
  assert.equal(result.status, 'SIMULATED_NOT_CAUSAL');
  assert.equal(result.summary.would_increase, 1); assert.equal(result.summary.hold, 1);
  assert.equal(result.summary.night_cap, 1);
  assert.equal(result.actions_executed, 0); assert.equal(result.meta_budget_writes, 0);
});

test('backtest fails transparently when historical metrics are absent', () => {
  const result = runMetaBudgetBacktest({ policy: META_BUDGET_POLICY_V1, metrics: [] });
  assert.equal(result.status, 'INSUFFICIENT_DATA'); assert.deepEqual(result.decisions, []);
});

test('backtest is hourly idempotent per campaign and policy version', () => {
  const result = runMetaBudgetBacktest({ policy: META_BUDGET_POLICY_V1, metrics: [
    row('2026-09-13T05:01:00Z', '7'), row('2026-09-13T05:59:00Z', '9')
  ] });
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].simulated_budget_after_cents, 2500);
});
