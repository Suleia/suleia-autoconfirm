import { pathToFileURL } from 'node:url';
import { loadMetaAdsConfig } from '../config.mjs';
import { createMetaAdsReadClient } from '../meta-ads-client.mjs';
import { loadMetaBudgetConfig } from '../budget/config.mjs';
import { MetaBudgetDecisionRepository } from '../budget/repository.mjs';
import { runMetaBudgetShadowCycle } from '../budget/shadow-cycle.mjs';

export async function main(env = process.env) {
  const readerConfig = loadMetaAdsConfig(env);
  const budgetConfig = loadMetaBudgetConfig(env);
  if (!budgetConfig.internalDatabaseWritesEnabled || !budgetConfig.databaseUrl) {
    throw new Error('Meta budget shadow requires explicitly enabled internal audit persistence');
  }
  const client = createMetaAdsReadClient(readerConfig);
  const repository = await MetaBudgetDecisionRepository.connect(budgetConfig.databaseUrl, {
    internalDatabaseWritesEnabled: true
  });
  try {
    const result = await runMetaBudgetShadowCycle({ budgetConfig, readerConfig, client, repository,
      audit: (event) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`) });
    process.stdout.write(`${JSON.stringify({ event: 'META_SHADOW_CYCLE_COMPLETE', ...result,
      decisions: result.decisions.map((decision) => ({ campaign_id: decision.campaignId,
        decision_id: decision.persistence.decisionId, evaluation_hour: decision.evaluationHour,
        budget_before_cents: decision.budgetBeforeCents, proposed_budget_cents: decision.budgetProposedCents,
        reason_code: decision.reasonCode, executed: false, meta_write_attempted: false })) })}\n`);
    return result;
  } finally { await repository.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: 'META_SHADOW_CYCLE_FAILED', code: error?.code || error?.message || 'UNKNOWN',
      actions_executed: 0, production_writes: 0, meta_budget_writes: 0, external_actions: 0 })}\n`);
    process.exitCode = 1;
  });
}

