import { randomUUID } from 'node:crypto';
import { runMetaAdsReadCycle } from '../read-cycle.mjs';
import { evaluateMetaBudgetPolicy, madridBusinessTime, META_BUDGET_POLICY_VERSION } from './policy.mjs';
import { normalizeMetaCampaignMetric, telegramPreviewPayload } from './normalizer.mjs';

const EVENT_BY_REASON = Object.freeze({
  WOULD_INCREASE: 'META_WOULD_INCREASE', HOLD_LOW_ROAS: 'META_HOLD_LOW_ROAS',
  HOLD_ROAS_NEUTRAL: 'META_HOLD_NEUTRAL_ROAS', HOLD_NIGHT: 'META_HOLD_NIGHT',
  WOULD_REDUCE_TO_NIGHT_CAP: 'META_WOULD_NIGHT_CAP', HOLD_DATA_NOT_RELIABLE: 'META_DATA_STALE'
});

export async function runMetaBudgetShadowCycle({
  budgetConfig, readerConfig = null, client = null, repository, readResult = null,
  now = new Date(), audit = () => {}, idFactory = randomUUID
}) {
  if (!['SIMULATION', 'SHADOW'].includes(budgetConfig?.mode)) throw new Error('META_BUDGET_MODE_NOT_ENABLED');
  const source = readResult || await runMetaAdsReadCycle({ config: readerConfig, client, now });
  const decisions = [];
  const evaluationHour = madridBusinessTime(now, budgetConfig.policy.timezone).evaluationHour;
  for (const campaign of source.campaigns || []) {
    const metric = normalizeMetaCampaignMetric(campaign, source, { now });
    const existing = await repository.getHourlyDecision(metric.campaignId, evaluationHour, META_BUDGET_POLICY_VERSION);
    if (existing) {
      decisions.push(Object.freeze({ ...existing, writeGateStatus: 'BLOCKED_BY_SIMULATION_MODE',
        persistence: { decisionId: existing.decisionId, inserted: false, idempotentReplay: true,
          internalDatabaseWrites: 0, actionsExecuted: 0, productionWrites: 0, metaBudgetWrites: 0, externalActions: 0 } }));
      continue;
    }
    const state = metric.budgetModel === 'CBO'
      ? await repository.getSimulationState(metric.campaignId, META_BUDGET_POLICY_VERSION) : null;
    const simulatedBefore = state?.simulatedBudgetCents ?? metric.actualMetaBudgetCents;
    const policyDecision = evaluateMetaBudgetPolicy({
      currentBudgetCents: simulatedBefore, purchaseRoas: metric.purchaseRoas,
      metricsStatus: metric.metricsStatus, budgetModel: metric.budgetModel,
      budgetPeriod: metric.budgetPeriod, campaignStatus: metric.campaignStatus,
      currency: metric.currency, evaluatedAt: now, policy: budgetConfig.policy
    });
    const decision = {
      decisionId: idFactory(), evaluationHour: policyDecision.evaluationHour,
      campaignId: metric.campaignId, campaignName: metric.campaignName,
      campaignStatus: metric.campaignStatus, budgetModel: metric.budgetModel,
      budgetPeriod: metric.budgetPeriod, actualMetaBudgetCents: metric.actualMetaBudgetCents,
      budgetBeforeCents: policyDecision.budgetBeforeCents,
      budgetProposedCents: policyDecision.budgetProposedCents,
      budgetDeltaCents: policyDecision.budgetDeltaCents, purchaseRoas: metric.purchaseRoas,
      metricsWindow: metric.metricsWindow, metricsStatus: metric.metricsStatus,
      localTime: policyDecision.localTime, timezone: policyDecision.timezone,
      policyVersion: policyDecision.policyVersion, decisionType: policyDecision.decisionType,
      reasonCode: policyDecision.reasonCode, reasonText: policyDecision.reasonText,
      mode: budgetConfig.mode, wouldExecute: policyDecision.wouldExecute,
      executed: false, metaWriteAttempted: false, writeGateStatus: 'BLOCKED_BY_SIMULATION_MODE',
      actionsExecuted: 0, productionWrites: 0, metaBudgetWrites: 0, externalActions: 0
    };
    decision.telegramPreviewPayload = telegramPreviewPayload(decision);
    const persistence = await repository.persistDecision(decision);
    decisions.push(Object.freeze({ ...decision, persistence }));
    audit({ event: 'META_POLICY_EVALUATED', campaign_id: metric.campaignId,
      evaluation_hour: decision.evaluationHour, reason_code: decision.reasonCode, mode: decision.mode,
      executed: false, meta_write_attempted: false, actions_executed: 0,
      production_writes: 0, meta_budget_writes: 0, external_actions: 0 });
    const event = EVENT_BY_REASON[decision.reasonCode];
    if (event) audit({ event, campaign_id: metric.campaignId, evaluation_hour: decision.evaluationHour,
      mode: decision.mode, production_writes: 0, meta_budget_writes: 0, external_actions: 0 });
  }
  return Object.freeze({
    ok: true, mode: budgetConfig.mode, policy_version: META_BUDGET_POLICY_VERSION,
    evaluation_hour: decisions[0]?.evaluationHour || null, campaigns_evaluated: decisions.length,
    decisions, meta_reads: source.meta_reads || 0, telegram_previews: decisions.length,
    telegram_sends: 0, actions_executed: 0, production_writes: 0, meta_budget_writes: 0,
    external_actions: 0, broader_management_scope_present: source.permissions?.broader_management_scope_present === true
  });
}
