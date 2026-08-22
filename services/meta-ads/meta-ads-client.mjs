import { collectPaginated, createReadOnlyTransport } from '../../packages/platform-core/src/read-only-transport.mjs';

const GRAPH_HOST = 'graph.facebook.com';
const CAMPAIGN_FIELDS = 'id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining';
const ADSET_FIELDS = 'id,campaign_id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining';
const INSIGHT_FIELDS = [
  'campaign_id',
  'campaign_name',
  'date_start',
  'date_stop',
  'spend',
  'actions',
  'action_values',
  'purchase_roas',
  'website_purchase_roas'
].join(',');

export class MetaAdsReadError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = 'MetaAdsReadError';
    this.code = code;
    this.status = status;
  }
}
function sanitizeNext(next, apiVersion) {
  if (!next) return null;
  const target = new URL(next);
  if (target.protocol !== 'https:' || target.hostname !== GRAPH_HOST) {
    throw new MetaAdsReadError('Meta pagination escaped the allowlisted host', 'META_PAGINATION_BLOCKED');
  }
  if (!target.pathname.startsWith(`/${apiVersion}/`)) {
    throw new MetaAdsReadError('Meta pagination changed API version', 'META_PAGINATION_BLOCKED');
  }
  target.searchParams.delete('access_token');
  return target.toString();
}

export function createMetaAdsReadClient({
  accessToken,
  accountId,
  apiVersion,
  timeoutMs = 15_000,
  maxRetries = 2,
  maxPages = 100,
  fetchImpl = globalThis.fetch
}) {
  if (!accessToken || !accountId || !apiVersion) throw new MetaAdsReadError('Incomplete Meta read configuration', 'META_CONFIG_MISSING');
  const base = new URL(`https://${GRAPH_HOST}/${apiVersion}/`);
  const transport = createReadOnlyTransport({
    fetchImpl,
    allowedHosts: [GRAPH_HOST],
    timeoutMs,
    maxRetries
  });
  let readCount = 0;

  async function getJson(pathOrUrl, parameters = {}) {
    const target = /^https:\/\//.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(pathOrUrl.replace(/^\//, ''), base);
    if (target.protocol !== 'https:' || target.hostname !== GRAPH_HOST || !target.pathname.startsWith(`/${apiVersion}/`)) {
      throw new MetaAdsReadError('Meta request target is not allowlisted', 'META_TARGET_BLOCKED');
    }
    if (target.searchParams.has('access_token')) {
      throw new MetaAdsReadError('Tokens in query strings are forbidden', 'META_QUERY_TOKEN_BLOCKED');
    }
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== null && value !== undefined) target.searchParams.set(key, String(value));
    }
    const response = await transport(target, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
    });
    readCount += 1;
    if (!response.ok) {
      throw new MetaAdsReadError(`Meta read failed with HTTP ${response.status}`, `META_HTTP_${response.status}`, response.status);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') throw new MetaAdsReadError('Meta returned an invalid payload', 'META_PAYLOAD_INVALID');
    return payload;
  }

  async function paginated(path, parameters) {
    return collectPaginated({
      maxPages,
      fetchPage: async (cursor) => {
        const payload = await getJson(cursor || path, cursor ? {} : parameters);
        if (!Array.isArray(payload.data)) throw new MetaAdsReadError('Meta collection is missing data[]', 'META_PAYLOAD_INVALID');
        return { items: payload.data, next_cursor: sanitizeNext(payload.paging?.next, apiVersion) };
      }
    });
  }

  return Object.freeze({
    async readPermissions() {
      const result = await paginated('me/permissions', { limit: 100 });
      if (!result.complete) throw new MetaAdsReadError('Meta permissions pagination is incomplete', result.reason);
      return result.items;
    },
    readAccount() {
      return getJson(`act_${accountId}`, {
        fields: 'id,account_status,currency,timezone_name,timezone_offset_hours_utc'
      });
    },
    async readActiveCampaigns() {
      const result = await paginated(`act_${accountId}/campaigns`, {
        fields: CAMPAIGN_FIELDS,
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: 100
      });
      if (!result.complete) throw new MetaAdsReadError('Meta campaign pagination is incomplete', result.reason);
      return result.items.filter((campaign) => campaign.effective_status === 'ACTIVE');
    },
    async readActiveAdSets(campaignId) {
      if (!/^\d+$/.test(String(campaignId))) throw new MetaAdsReadError('Invalid campaign ID', 'META_ID_INVALID');
      const result = await paginated(`${campaignId}/adsets`, {
        fields: ADSET_FIELDS,
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: 100
      });
      if (!result.complete) throw new MetaAdsReadError('Meta ad-set pagination is incomplete', result.reason);
      return result.items.filter((adset) => adset.effective_status === 'ACTIVE');
    },
    async readCampaignInsights({ businessDate }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate))) throw new MetaAdsReadError('Invalid business date', 'META_DATE_INVALID');
      const result = await paginated(`act_${accountId}/insights`, {
        level: 'campaign',
        fields: INSIGHT_FIELDS,
        time_range: JSON.stringify({ since: businessDate, until: businessDate }),
        time_increment: 1,
        action_report_time: 'conversion',
        use_account_attribution_setting: 'true',
        limit: 100
      });
      if (!result.complete) throw new MetaAdsReadError('Meta insights pagination is incomplete', result.reason);
      return result.items;
    },
    requestCount() {
      return readCount;
    }
  });
}
