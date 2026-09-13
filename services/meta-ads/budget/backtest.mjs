import { evaluateMetaBudgetPolicy, META_BUDGET_POLICY_VERSION } from './policy.mjs';

export function runMetaBudgetBacktest({ metrics = [], policy, mode = 'SIMULATION' }) {
  if (!['SIMULATION', 'SHADOW'].includes(mode)) throw new Error('META_BUDGET_MODE_NOT_ENABLED');
  if (!Array.isArray(metrics) || metrics.length === 0) return Object.freeze({
    status: 'INSUFFICIENT_DATA', policy_version: META_BUDGET_POLICY_VERSION, decisions: [],
    summary: { would_increase: 0, hold: 0, night_cap: 0, review: 0 },
    actions_executed: 0, production_writes: 0, meta_budget_writes: 0, external_actions: 0
  });
  const ordered = [...metrics].sort((a, b) => new Date(a.evaluatedAt) - new Date(b.evaluatedAt));
  const simulated = new Map(); const decisions = []; const evaluatedHours = new Set();
  for (const row of ordered) {
    const key = String(row.campaignId);
    const before = simulated.has(key) ? simulated.get(key) : row.actualMetaBudgetCents;
    const evaluated = evaluateMetaBudgetPolicy({ currentBudgetCents: before, purchaseRoas: row.purchaseRoas,
      metricsStatus: row.metricsStatus, budgetModel: row.budgetModel, budgetPeriod: row.budgetPeriod,
      campaignStatus: row.campaignStatus, currency: row.currency, evaluatedAt: row.evaluatedAt, policy });
    const idempotencyKey = `${key}:${evaluated.evaluationHour}:${META_BUDGET_POLICY_VERSION}`;
    if (evaluatedHours.has(idempotencyKey)) continue;
    evaluatedHours.add(idempotencyKey);
    if (Number.isSafeInteger(evaluated.budgetProposedCents) && row.budgetModel === 'CBO') simulated.set(key, evaluated.budgetProposedCents);
    decisions.push(Object.freeze({ campaign_id: key, campaign_name: String(row.campaignName || ''),
      evaluation_hour: evaluated.evaluationHour, actual_meta_budget_cents: row.actualMetaBudgetCents,
      simulated_budget_before_cents: evaluated.budgetBeforeCents,
      simulated_budget_after_cents: evaluated.budgetProposedCents, purchase_roas: row.purchaseRoas,
      decision_type: evaluated.decisionType, reason_code: evaluated.reasonCode,
      executed: false, meta_write_attempted: false }));
  }
  const count = (predicate) => decisions.filter(predicate).length;
  return Object.freeze({
    status: 'SIMULATED_NOT_CAUSAL', policy_version: META_BUDGET_POLICY_VERSION, decisions,
    summary: {
      would_increase: count((item) => item.reason_code === 'WOULD_INCREASE'),
      hold: count((item) => item.decision_type === 'HOLD'),
      night_cap: count((item) => item.reason_code === 'WOULD_REDUCE_TO_NIGHT_CAP'),
      review: count((item) => ['SIMULATION_ONLY_REVIEW', 'BLOCK_POLICY'].includes(item.decision_type))
    },
    actions_executed: 0, production_writes: 0, meta_budget_writes: 0, external_actions: 0
  });
}
