import { publicMetaBudgetPolicy } from './policy.mjs';
import { MetaBudgetWriter } from './writer.mjs';

export function createMetaBudgetReadService(repository) {
  const writer = new MetaBudgetWriter();
  return Object.freeze({
    listMetaCampaigns: (limit) => repository.listLatest(limit),
    getMetaCampaign: async (campaignId) => (await repository.listLatest(250)).find((row) => row.campaign_id === campaignId) || null,
    getMetaBudgetPolicy: async () => publicMetaBudgetPolicy(),
    getMetaBudgetSimulation: (limit) => repository.listLatest(limit),
    getMetaBudgetHistory: (options) => repository.history(options),
    previewMetaBudgetChange: async (decision) => writer.previewChange(decision)
  });
}

// This interface is deliberately not registered in the public MCP catalog in this phase.
export const FUTURE_META_MCP_TOOL_NAMES = Object.freeze([
  'list_meta_campaigns', 'get_meta_campaign', 'get_meta_budget_policy',
  'get_meta_budget_simulation', 'get_meta_budget_history', 'preview_meta_budget_change'
]);
