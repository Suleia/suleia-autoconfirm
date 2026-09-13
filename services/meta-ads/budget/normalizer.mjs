import { businessDateInTimezone } from '../read-cycle.mjs';

export function normalizeMetaCampaignMetric(campaign, readResult, { now = new Date() } = {}) {
  const currency = String(readResult?.account?.currency || '');
  const timezone = String(readResult?.account?.timezone || '');
  const expectedDate = businessDateInTimezone(now, 'Europe/Madrid');
  const dateMatches = campaign?.date_stop === expectedDate && campaign?.date_start === expectedDate;
  const budgetModel = campaign?.budget_owner === 'CAMPAIGN' ? 'CBO'
    : campaign?.budget_owner === 'AD_SET' ? 'ABO' : 'UNKNOWN';
  const completeIdentity = Boolean(campaign?.campaign_id) && Boolean(campaign?.effective_status);
  const completeBudget = budgetModel === 'ABO'
    ? Array.isArray(campaign?.adsets) && campaign.adsets.length > 0
    : Number.isSafeInteger(campaign?.budget_minor);
  let metricsStatus = 'FRESH';
  if (!readResult?.ok) metricsStatus = 'FAILED';
  else if (!completeIdentity || !completeBudget || timezone !== 'Europe/Madrid') metricsStatus = 'INCOMPLETE';
  else if (!dateMatches) metricsStatus = 'STALE';
  return Object.freeze({
    campaignId: String(campaign?.campaign_id || ''), campaignName: String(campaign?.campaign_name || ''),
    campaignStatus: String(campaign?.effective_status || 'UNKNOWN'), budgetModel,
    budgetPeriod: String(campaign?.budget_period || 'NONE'), actualMetaBudgetCents: campaign?.budget_minor ?? null,
    purchaseRoas: campaign?.purchase_roas_status === 'AVAILABLE' ? campaign.purchase_roas : null,
    purchaseRoasStatus: String(campaign?.purchase_roas_status || 'NO_DATA'), metricsStatus,
    metricsWindow: Object.freeze({ date_start: campaign?.date_start || null, date_stop: campaign?.date_stop || null }),
    currency, timezone, sourceObservedAt: now.toISOString(),
    adsets: Object.freeze((campaign?.adsets || []).map((adset) => Object.freeze({ ...adset })))
  });
}

export function telegramPreviewPayload(decision) {
  const euros = (cents) => cents === null || cents === undefined ? 'N/D' : `${(cents / 100).toFixed(2)} EUR`;
  return Object.freeze({
    delivery: 'PREVIEW_ONLY', title: 'SIMULATION - NO REAL CHANGES', campaign_id: decision.campaignId,
    campaign_name: decision.campaignName, change: `${euros(decision.budgetBeforeCents)} -> ${euros(decision.budgetProposedCents)}`,
    purchase_roas: decision.purchaseRoas, reason: decision.reasonCode, sent: false,
    telegram_sends: 0, external_actions: 0
  });
}
