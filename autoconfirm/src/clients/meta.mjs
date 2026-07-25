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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(30000, retryAfter * 1000);
  }
  return Math.min(8000, 750 * (2 ** (attempt - 1)));
}

function networkErrorDetail(error) {
  const codes = new Set();
  const pending = [error, error?.cause, ...(Array.isArray(error?.cause?.errors) ? error.cause.errors : [])];
  for (const item of pending) {
    if (item?.code) codes.add(String(item.code));
  }
  if (codes.size) return [...codes].join(',');
  return error?.name || 'network_error';
}

async function metaRequest(path, params = {}) {
  if (!config.metaAccessToken) throw new Error('Falta META_ACCESS_TOKEN.');

  const url = graphUrl(path, { ...params, access_token: config.metaAccessToken });
  const maxAttempts = Math.max(1, Number(config.metaRequestMaxAttempts || 3));
  const timeoutMs = Math.max(1000, Number(config.metaRequestTimeoutMs || 15000));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs(null, attempt));
        continue;
      }
      const detail = error?.name === 'AbortError'
        ? `timeout_${timeoutMs}ms`
        : networkErrorDetail(error);
      throw new Error(`Meta no respondio tras ${maxAttempts} intentos (${detail}).`, { cause: error });
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json().catch(() => null);
    if (response.ok && !data?.error) return data;

    if (retryableStatus(response.status) && attempt < maxAttempts) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    throw new Error(`Meta respondio ${response.status}: ${JSON.stringify(data?.error || data)}`);
  }

  throw new Error('Meta no pudo completar la solicitud.');
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

export async function getCampaigns({ limit = 100, includeBudgetFields = false } = {}) {
  const adAccountId = normalizeAdAccountId(config.metaAdAccountId);
  if (!adAccountId) throw new Error('Falta META_AD_ACCOUNT_ID.');

  const baseFields = ['id', 'name', 'status', 'effective_status', 'objective', 'created_time', 'updated_time'];
  const budgetFields = ['daily_budget', 'lifetime_budget', 'budget_remaining', 'spend_cap', 'bid_strategy'];

  const result = await metaRequest(`${adAccountId}/campaigns`, {
    fields: [
      ...baseFields,
      ...(includeBudgetFields ? budgetFields : [])
    ].join(','),
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
