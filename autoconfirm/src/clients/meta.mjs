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
  const purchaseValue = actionValue(row.action_values, 'purchase') || actionValue(row.action_values, 'offsite_conversion.fb_pixel_purchase');
  const roas = Array.isArray(row.purchase_roas) ? Number(row.purchase_roas[0]?.value || 0) : 0;

  return {
    campaignId: row.campaign_id || '',
    campaignName: row.campaign_name || 'Sin campana',
    adsetId: row.adset_id || '',
    adsetName: row.adset_name || '',
    adId: row.ad_id || '',
    adName: row.ad_name || '',
    dateStart: row.date_start || '',
    dateStop: row.date_stop || '',
    spend,
    impressions,
    reach,
    clicks,
    ctr: Number(row.ctr || 0),
    cpc: Number(row.cpc || 0),
    cpm: Number(row.cpm || 0),
    purchases,
    purchaseValue,
    costPerPurchase: purchases ? spend / purchases : null,
    roas: Number.isFinite(roas) ? roas : null
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

export async function getCampaignInsights({ since, until, datePreset, level = 'campaign', limit = 100, timeIncrement = null } = {}) {
  const adAccountId = normalizeAdAccountId(config.metaAdAccountId);
  if (!adAccountId) throw new Error('Falta META_AD_ACCOUNT_ID.');

  const params = {
    level,
    fields: [
      'campaign_id',
      'campaign_name',
      level !== 'campaign' ? 'adset_id' : null,
      level !== 'campaign' ? 'adset_name' : null,
      level === 'ad' ? 'ad_id' : null,
      level === 'ad' ? 'ad_name' : null,
      'spend',
      'impressions',
      'reach',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'actions',
      'action_values',
      'purchase_roas',
      'date_start',
      'date_stop'
    ].filter(Boolean).join(','),
    limit
  };

  if (timeIncrement) {
    params.time_increment = timeIncrement;
  }

  if (datePreset) {
    params.date_preset = datePreset;
  } else {
    params.time_range = { since, until };
  }

  const result = await metaRequest(`${adAccountId}/insights`, {
    ...params
  });

  return (result.data || []).map(normalizeInsight);
}
