import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMetaBudgetConfig } from './config.mjs';
import { runMetaBudgetShadowCycle } from './shadow-cycle.mjs';

class MemoryRepository {
  constructor() { this.states = new Map(); this.decisions = new Map(); this.writes = 0; }
  key(campaignId, version) { return `${campaignId}:${version}`; }
  decisionKey(campaignId, hour, version) { return `${campaignId}:${hour}:${version}`; }
  async getSimulationState(campaignId, version) { return this.states.get(this.key(campaignId, version)) || null; }
  async getHourlyDecision(campaignId, hour, version) { return this.decisions.get(this.decisionKey(campaignId, hour, version)) || null; }
  async persistDecision(decision) {
    const key = this.decisionKey(decision.campaignId, decision.evaluationHour, decision.policyVersion);
    if (this.decisions.has(key)) return { decisionId: this.decisions.get(key).decisionId, inserted: false, idempotentReplay: true };
    this.decisions.set(key, decision); this.writes += 1;
    if (decision.budgetModel === 'CBO' && Number.isSafeInteger(decision.budgetProposedCents)) {
      this.states.set(this.key(decision.campaignId, decision.policyVersion), {
        actualMetaBudgetCents: decision.actualMetaBudgetCents,
        simulatedBudgetCents: decision.budgetProposedCents,
        lastEvaluationHour: decision.evaluationHour
      });
    }
    return { decisionId: decision.decisionId, inserted: true, idempotentReplay: false,
      internalDatabaseWrites: 1, actionsExecuted: 0, productionWrites: 0, metaBudgetWrites: 0, externalActions: 0 };
  }
}

const config = loadMetaBudgetConfig({ META_AUTOMATION_MODE: 'SHADOW' });
function source({ roas = 7, actual = 1500, budgetOwner = 'CAMPAIGN', adsets = [] } = {}) {
  return { ok: true, account: { currency: 'EUR', timezone: 'Europe/Madrid' },
    permissions: { broader_management_scope_present: false }, meta_reads: 4,
    campaigns: [{ campaign_id: '1001', campaign_name: 'Campaign fixture', effective_status: 'ACTIVE',
      budget_owner: budgetOwner, budget_period: budgetOwner === 'CAMPAIGN' ? 'DAILY' : 'MULTIPLE',
      budget_minor: budgetOwner === 'CAMPAIGN' ? actual : null, adsets,
      purchase_roas: roas, purchase_roas_status: 'AVAILABLE',
      date_start: '2026-09-13', date_stop: '2026-09-13' }] };
}

test('shadow advances simulated budget sequentially while preserving the real Meta budget', async () => {
  const repository = new MemoryRepository();
  const hours = ['2026-09-13T05:00:00Z', '2026-09-13T06:00:00Z', '2026-09-13T07:00:00Z'];
  const results = [];
  for (const at of hours) results.push(await runMetaBudgetShadowCycle({ budgetConfig: config,
    repository, readResult: source(), now: new Date(at), idFactory: () => `decision-${results.length + 1}` }));
  assert.deepEqual(results.map((item) => item.decisions[0].budgetBeforeCents), [1500, 2500, 3500]);
  assert.deepEqual(results.map((item) => item.decisions[0].budgetProposedCents), [2500, 3500, 4500]);
  assert.deepEqual(results.map((item) => item.decisions[0].actualMetaBudgetCents), [1500, 1500, 1500]);
  for (const result of results) {
    assert.equal(result.meta_budget_writes, 0); assert.equal(result.telegram_sends, 0);
    assert.equal(result.production_writes, 0); assert.equal(result.external_actions, 0);
  }
});

test('same campaign and UTC hour is idempotent and does not advance state twice', async () => {
  const repository = new MemoryRepository(); const now = new Date('2026-09-13T05:05:00Z');
  const first = await runMetaBudgetShadowCycle({ budgetConfig: config, repository, readResult: source(), now });
  const second = await runMetaBudgetShadowCycle({ budgetConfig: config, repository, readResult: source(), now: new Date('2026-09-13T05:59:00Z') });
  assert.equal(repository.writes, 1);
  assert.equal(first.decisions[0].budgetProposedCents, 2500);
  assert.equal(second.decisions[0].budgetProposedCents, 2500);
  assert.equal(second.decisions[0].persistence.idempotentReplay, true);
});

test('night cap updates only simulated state and 07:00 can scale from 35 EUR', async () => {
  const repository = new MemoryRepository();
  const night = await runMetaBudgetShadowCycle({ budgetConfig: config, repository,
    readResult: source({ actual: 7000, roas: 12 }), now: new Date('2026-09-13T00:00:00Z') });
  const day = await runMetaBudgetShadowCycle({ budgetConfig: config, repository,
    readResult: source({ actual: 7000, roas: 12 }), now: new Date('2026-09-13T05:00:00Z') });
  assert.equal(night.decisions[0].reasonCode, 'WOULD_REDUCE_TO_NIGHT_CAP');
  assert.equal(night.decisions[0].budgetProposedCents, 3500);
  assert.equal(day.decisions[0].budgetBeforeCents, 3500);
  assert.equal(day.decisions[0].budgetProposedCents, 4500);
});

test('ABO stays review-only and never invents an aggregate allocation', async () => {
  const repository = new MemoryRepository();
  const result = await runMetaBudgetShadowCycle({ budgetConfig: config, repository,
    readResult: source({ budgetOwner: 'AD_SET', adsets: [{ adset_id: '20', budget_minor: 1500 }] }),
    now: new Date('2026-09-13T05:00:00Z') });
  assert.equal(result.decisions[0].reasonCode, 'SIMULATION_ONLY_REVIEW_ABO');
  assert.equal(result.decisions[0].budgetProposedCents, null);
  assert.equal(repository.states.size, 0);
});

