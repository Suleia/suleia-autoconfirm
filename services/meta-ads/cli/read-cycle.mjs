import { loadMetaAdsConfig } from '../config.mjs';
import { createMetaAdsReadClient } from '../meta-ads-client.mjs';
import { runMetaAdsReadCycle } from '../read-cycle.mjs';

const config = loadMetaAdsConfig();
const client = createMetaAdsReadClient(config);
const result = await runMetaAdsReadCycle({ config, client });
const cbo = result.campaigns.filter((campaign) => campaign.budget_owner === 'CAMPAIGN').length;
const abo = result.campaigns.filter((campaign) => campaign.budget_owner === 'AD_SET').length;
const withRoas = result.campaigns.filter((campaign) => campaign.purchase_roas_status === 'AVAILABLE').length;
process.stdout.write(`${JSON.stringify({
  ok: result.ok,
  execution_mode: result.execution_mode,
  business_date: result.business_date,
  account_currency: result.account.currency,
  account_timezone: result.account.timezone,
  active_campaigns: result.active_campaign_count,
  campaign_budget_owners: cbo,
  adset_budget_owners: abo,
  campaigns_with_purchase_roas: withRoas,
  meta_reads: result.meta_reads,
  meta_budget_writes: result.meta_budget_writes,
  telegram_messages: result.telegram_messages
})}\n`);
