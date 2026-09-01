import { readBudgetFields, minorUnitsToCurrency } from './meta-money.mjs';
import { parseSpend, selectPurchaseRoas, selectWebsitePurchaseMetric } from './purchase-roas.mjs';

export function businessDateInTimezone(now = new Date(), timezone = 'Europe/Madrid') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function previousBusinessDateInTimezone(now = new Date(), timezone = 'Europe/Madrid') {
  const current = businessDateInTimezone(now, timezone);
  const previous = new Date(`${current}T12:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}
function permissionState(rows) {
  return Object.fromEntries((Array.isArray(rows) ? rows : [])
    .filter((row) => ['ads_read', 'ads_management', 'business_management'].includes(row?.permission))
    .map((row) => [row.permission, row.status]));
}

async function resolveBudget(client, campaign) {
  const campaignBudget = readBudgetFields(campaign);
  if (campaignBudget.budget_period !== 'NONE') {
    return {
      budget_owner: 'CAMPAIGN',
      budget_period: campaignBudget.budget_period,
      budget_minor: campaignBudget.budget_minor,
      budget_eur: minorUnitsToCurrency(campaignBudget.budget_minor),
      adsets: []
    };
  }
  const adsets = await client.readActiveAdSets(campaign.id);
  const budgets = adsets.map((adset) => {
    const budget = readBudgetFields(adset);
    return {
      adset_id: String(adset.id),
      effective_status: adset.effective_status,
      budget_period: budget.budget_period,
      budget_minor: budget.budget_minor,
      budget_eur: budget.budget_minor === null ? null : minorUnitsToCurrency(budget.budget_minor)
    };
  });
  return {
    budget_owner: budgets.some((item) => item.budget_period !== 'NONE') ? 'AD_SET' : 'UNKNOWN',
    budget_period: 'MULTIPLE',
    budget_minor: null,
    budget_eur: null,
    adsets: budgets
  };
}

export async function runMetaAdsReadCycle({ config, client, now = new Date() }) {
  if (config.executionMode !== 'SIMULATION' || config.writesEnabled !== false) {
    throw new Error('Meta read cycle is restricted to SIMULATION with writes disabled');
  }
  const [account, permissions] = await Promise.all([client.readAccount(), client.readPermissions()]);
  const permission = permissionState(permissions);
  if (permission.ads_read !== 'granted') throw new Error('META_ADS_READ_PERMISSION_MISSING');
  if (String(account.currency) !== config.expectedCurrency) throw new Error('META_ADS_CURRENCY_MISMATCH');
  if (String(account.timezone_name) !== config.expectedTimezone) throw new Error('META_ADS_TIMEZONE_MISMATCH');
  if (Number(account.account_status) !== 1) throw new Error('META_ADS_ACCOUNT_NOT_ACTIVE');

  const businessDate = businessDateInTimezone(now, config.expectedTimezone);
  const [campaigns, insights] = await Promise.all([
    client.readActiveCampaigns(),
    client.readCampaignInsights({ businessDate })
  ]);
  const insightsByCampaign = new Map(insights.map((row) => [String(row.campaign_id), row]));
  const rows = [];
  for (const campaign of campaigns) {
    const insight = insightsByCampaign.get(String(campaign.id)) || {};
    const budget = await resolveBudget(client, campaign);
    const roas = selectPurchaseRoas(insight);
    const purchases = selectWebsitePurchaseMetric(insight.actions);
    const purchaseValue = selectWebsitePurchaseMetric(insight.action_values);
    rows.push({
      campaign_id: String(campaign.id),
      campaign_name: String(campaign.name || ''),
      effective_status: campaign.effective_status,
      ...budget,
      purchase_roas: roas.value,
      purchase_roas_status: roas.status,
      purchase_roas_field: roas.field,
      purchase_roas_action_type: roas.action_type,
      purchases: purchases.value,
      purchase_value: purchaseValue.value,
      spend: parseSpend(insight.spend),
      date_start: insight.date_start || businessDate,
      date_stop: insight.date_stop || businessDate
    });
  }

  return Object.freeze({
    ok: true,
    execution_mode: 'SIMULATION',
    business_date: businessDate,
    account: {
      status: Number(account.account_status),
      currency: account.currency,
      timezone: account.timezone_name,
      timezone_offset_hours_utc: Number(account.timezone_offset_hours_utc)
    },
    permissions: {
      ads_read: permission.ads_read === 'granted',
      broader_management_scope_present: permission.ads_management === 'granted'
    },
    active_campaign_count: rows.length,
    campaigns: rows,
    meta_reads: client.requestCount(),
    meta_budget_writes: 0,
    telegram_messages: 0
  });
}

export async function runMetaAdsFinanceSpendReadCycle({ config, client, now = new Date(), businessDate = null }) {
  if (config.executionMode !== 'SIMULATION' || config.writesEnabled !== false) {
    throw new Error('Meta finance read cycle is restricted to SIMULATION with writes disabled');
  }
  const [account, permissions] = await Promise.all([client.readAccount(), client.readPermissions()]);
  const permission = permissionState(permissions);
  if (permission.ads_read !== 'granted') throw new Error('META_ADS_READ_PERMISSION_MISSING');
  if (String(account.currency) !== config.expectedCurrency) throw new Error('META_ADS_CURRENCY_MISMATCH');
  if (String(account.timezone_name) !== config.expectedTimezone) throw new Error('META_ADS_TIMEZONE_MISMATCH');
  if (Number(account.account_status) !== 1) throw new Error('META_ADS_ACCOUNT_NOT_ACTIVE');

  const targetDate = businessDate || previousBusinessDateInTimezone(now, config.expectedTimezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)
    || targetDate >= businessDateInTimezone(now, config.expectedTimezone)) {
    throw new Error('FINANCE_SYNC_BUSINESS_DATE_NOT_CLOSED');
  }
  const insights = await client.readCampaignInsights({ businessDate: targetDate });
  const rows = insights.map((insight) => {
    const roas = selectPurchaseRoas(insight);
    const purchases = selectWebsitePurchaseMetric(insight.actions);
    const purchaseValue = selectWebsitePurchaseMetric(insight.action_values);
    return {
      campaign_id: String(insight.campaign_id),
      purchase_roas: roas.value,
      purchase_roas_status: roas.status,
      purchase_roas_field: roas.field,
      purchase_roas_action_type: roas.action_type,
      purchases: purchases.value,
      purchase_value: purchaseValue.value,
      spend: parseSpend(insight.spend),
      date_start: insight.date_start || targetDate,
      date_stop: insight.date_stop || targetDate
    };
  });

  return Object.freeze({
    ok: true,
    execution_mode: 'SIMULATION',
    business_date: targetDate,
    account: {
      status: Number(account.account_status),
      currency: account.currency,
      timezone: account.timezone_name,
      timezone_offset_hours_utc: Number(account.timezone_offset_hours_utc)
    },
    permissions: {
      ads_read: permission.ads_read === 'granted',
      broader_management_scope_present: permission.ads_management === 'granted'
    },
    campaign_count: rows.length,
    campaigns: rows,
    meta_reads: client.requestCount(),
    meta_budget_writes: 0,
    telegram_messages: 0
  });
}
