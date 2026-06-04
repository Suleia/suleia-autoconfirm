import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return null;
  const raw = String(adAccountId).trim();
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

function graphUrl(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${config.metaApiVersion}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  });
  return url;
}

async function metaRequest(path, params = {}) {
  if (!config.metaAccessToken) throw new Error('Falta META_ACCESS_TOKEN.');

  const url = graphUrl(path, { ...params, access_token: config.metaAccessToken });
  const response = await fetch(url);
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.error) {
    throw new Error(`Meta respondio ${response.status}: ${JSON.stringify(data?.error || data)}`);
  }

  return data;
}

function actionValue(actions, actionType) {
  const item = Array.isArray(actions)
    ? actions.find((action) => action.action_type === actionType)
    : null;
  const value = Number(item?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeInsight(row) {
  const spend = Number(row.spend || 0);
  const clicks = Number(row.clicks || 0);
  const impressions = Number(row.impressions || 0);
  const reach = Number(row.reach || 0);
  const purchases = actionValue(row.actions, 'purchase') || actionValue(row.actions, 'offsite_conversion.fb_pixel_purchase');

  return {
    campaignId: row.campaign_id || '',
    campaignName: row.campaign_name || 'Sin campana',
    spend,
    impressions,
    reach,
    clicks,
    ctr: Number(row.ctr || 0),
    cpc: Number(row.cpc || 0),
    cpm: Number(row.cpm || 0),
    purchases,
    costPerPurchase: purchases ? spend / purchases : null
  };
}

export async function getAdAccountSummary() {
  const adAccountId = normalizeAdAccountId(config.metaAdAccountId);
  if (!adAccountId) throw new Error('Falta META_AD_ACCOUNT_ID.');

  return metaRequest(adAccountId, {
    fields: 'id,name,account_status,disable_reason,currency,timezone_name,amount_spent,balance'
  });
}

export async function getCampaigns({ limit = 100 } = {}) {
  const adAccountId = normalizeAdAccountId(config.metaAdAccountId);
  if (!adAccountId) throw new Error('Falta META_AD_ACCOUNT_ID.');

  const result = await metaRequest(`${adAccountId}/campaigns`, {
    fields: 'id,name,status,effective_status,objective,created_time,updated_time',
    limit
  });

  return result.data || [];
}

export async function getCampaignInsights({ since, until, limit = 100 } = {}) {
  const adAccountId = normalizeAdAccountId(config.metaAdAccountId);
  if (!adAccountId) throw new Error('Falta META_AD_ACCOUNT_ID.');

  const result = await metaRequest(`${adAccountId}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions',
    time_range: { since, until },
    limit
  });

  return (result.data || []).map(normalizeInsight);
}
