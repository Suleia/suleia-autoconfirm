import { collectPaginated, createReadOnlyTransport } from '../../packages/platform-core/src/read-only-transport.mjs';
import {businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';
import {parseMetaCurrencyCents} from './meta-money.mjs';

const GRAPH_HOST = 'graph.facebook.com';
const CAMPAIGN_FIELDS = 'id,account_id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining';
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
  let active=0,usage=null;const waiting=[];

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
    if(active>=2)await new Promise(resolve=>waiting.push(resolve));else active++;
    let response;try{response = await transport(target, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
    });}finally{const next=waiting.shift();if(next)next();else active--;}
    const header=response.headers?.get?.('x-ad-account-usage');
    if(header)try{const parsed=JSON.parse(header);usage={accIdUtilPct:Number(parsed.acc_id_util_pct)||0};}catch{}
    readCount += 1;
    if (!response.ok) {
      const payload=await response.json().catch(()=>null),failure=new MetaAdsReadError(`Meta read failed with HTTP ${response.status}`, `META_HTTP_${response.status}`, response.status);
      // Numeric provider diagnostics only. Error text, URLs and bodies can
      // contain account details; never attach them to shared reports or logs.
      failure.providerCode=Number.isInteger(payload?.error?.code)?payload.error.code:null;
      failure.providerSubcode=Number.isInteger(payload?.error?.error_subcode)?payload.error.error_subcode:null;
      failure.transient=payload?.error?.is_transient===true;
      if(response.status===400&&failure.providerCode===17)failure.code='META_RATE_LIMITED';
      throw failure;
    }
    const payload = await response.json();
    if (payload?.error) throw new MetaAdsReadError('Meta returned an API error', 'META_API_ERROR', response.status);
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
    configuredAccountId:String(accountId).replace(/^act_/,''),
    async readAdRankings({since,until}) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(since)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||since>until||Date.parse(until)-Date.parse(since)>30*86400000)throw new MetaAdsReadError('Invalid ranking period','META_PERIOD_INVALID');
      const result=await paginated(`act_${accountId}/insights`,{level:'ad',fields:'ad_id,quality_ranking,engagement_rate_ranking,conversion_rate_ranking',time_range:JSON.stringify({since,until}),action_attribution_windows:JSON.stringify(['7d_click','1d_view']),action_report_time:'conversion',limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete rankings','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readActivityHistory({since,until}) {
      const start=Date.parse(businessDayBounds({businessDate:since}).utc_start),end=Date.parse(businessDayBounds({businessDate:until}).utc_end_exclusive)-1000;
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||end-start>32*86400000)throw new MetaAdsReadError('Invalid activity period','META_PERIOD_INVALID');
      const result=await paginated(`act_${accountId}/activities`,{fields:'event_time,event_type,object_id,object_name,actor_id,actor_name,application_id,application_name,extra_data',since:Math.floor(start/1000),until:Math.floor(end/1000),limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete activity history','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readAuditDetails(level) {
      const fields={campaign:'id,name,objective,bid_strategy,daily_budget,lifetime_budget,created_time,updated_time,status,effective_status',adset:'id,campaign_id,name,optimization_goal,bid_strategy,daily_budget,lifetime_budget,created_time,updated_time,status,effective_status,learning_stage_info',ad:'id,campaign_id,adset_id,name,created_time,updated_time,status,effective_status'};
      if(!fields[level])throw new MetaAdsReadError('Invalid level','META_LEVEL_INVALID');
      const result=await paginated(`act_${accountId}/${level==='campaign'?'campaigns':level==='adset'?'adsets':'ads'}`,{fields:fields[level],limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete audit inventory','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readAuditRules() {
      const result=await paginated(`act_${accountId}/adrules_library`,{fields:'id,name,status,execution_spec,evaluation_spec,schedule_spec',limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete rules','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readHourlyTraffic({since,until}) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(since)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||since>until||Date.parse(until)-Date.parse(since)>30*86400000)throw new MetaAdsReadError('Invalid hourly period','META_PERIOD_INVALID');
      const result=await paginated(`act_${accountId}/insights`,{level:'campaign',fields:'campaign_id,campaign_name,date_start,date_stop,spend,impressions,inline_link_clicks',time_range:JSON.stringify({since,until}),time_increment:1,breakdowns:'hourly_stats_aggregated_by_advertiser_time_zone',action_attribution_windows:JSON.stringify(['7d_click','1d_view']),action_report_time:'conversion',limit:500});
      if(!result.complete)throw new MetaAdsReadError('Incomplete hourly traffic','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readHourlyReportedActions({since,until}) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(since)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||since>until||Date.parse(until)-Date.parse(since)>30*86400000)throw new MetaAdsReadError('Invalid hourly period','META_PERIOD_INVALID');
      const result=await paginated(`act_${accountId}/insights`,{level:'campaign',fields:'campaign_id,date_start,date_stop,actions,action_values',time_range:JSON.stringify({since,until}),time_increment:1,breakdowns:'hourly_stats_aggregated_by_advertiser_time_zone',action_attribution_windows:JSON.stringify(['7d_click','1d_view']),action_report_time:'conversion',limit:500});
      if(!result.complete)throw new MetaAdsReadError('Incomplete hourly actions','META_PAGINATION_INCOMPLETE');return result.items;
    },
    async readCreatives(){
      const result=await paginated(`act_${accountId}/ads`,{fields:'id,creative{id,thumbnail_url,image_url,effective_object_story_id}',limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete creatives','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    usage(){return usage;},
    async readCampaigns() {
      const result = await paginated(`act_${accountId}/campaigns`, { fields: CAMPAIGN_FIELDS, limit: 100 });
      if (!result.complete) throw new MetaAdsReadError('Incomplete campaign inventory', 'META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    readCampaign(id) {
      if (!/^\d+$/.test(String(id))) throw new MetaAdsReadError('Invalid campaign ID', 'META_ID_INVALID');
      return getJson(String(id), { fields: CAMPAIGN_FIELDS });
    },
    async readRules() {
      const result = await paginated(`act_${accountId}/adrules_library`, { fields: 'id,status,execution_spec,evaluation_spec', limit: 100 });
      if (!result.complete) throw new MetaAdsReadError('Incomplete rules inventory', 'META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readMinimumBudgets() {
      const result=await paginated(`act_${accountId}/minimum_budgets`,{fields:'currency,min_daily_budget_high_freq,min_daily_budget_imp,min_daily_budget_low_freq,min_daily_budget_video_views',limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete budget constraints','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readAccountDaySpend({since,until}) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(since)||since!==until)throw new MetaAdsReadError('Invalid account spend day','META_PERIOD_INVALID');
      const at=new Date().toISOString();
      const result=await paginated(`act_${accountId}/insights`,{level:'account',fields:'account_id,date_start,date_stop,spend',time_range:JSON.stringify({since,until}),action_attribution_windows:JSON.stringify(['7d_click','1d_view']),action_report_time:'conversion',limit:100});
      if(!result.complete||result.items.length!==1)return {complete:false,spendCents:null,date:since,observedAt:at};
      const row=result.items[0];
      if(String(row.account_id)!==String(accountId)||row.date_start!==since||row.date_stop!==until)throw new MetaAdsReadError('Account spend identity mismatch','META_ACCOUNT_SPEND_IDENTITY');
      const cents=parseMetaCurrencyCents(row.spend);
      return {complete:cents!==null,spendCents:cents,date:since,observedAt:at};
    },
    async readDelivery() {
      const result = await paginated(`act_${accountId}/ads`, { fields: 'id,campaign_id,adset_id,status,effective_status', limit: 100 });
      if (!result.complete) throw new MetaAdsReadError('Incomplete delivery inventory', 'META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readEntities(level) {
      if(level==='campaign')return this.readCampaigns();
      if(!['adset','ad'].includes(level))throw new MetaAdsReadError('Invalid entity level','META_LEVEL_INVALID');
      const result=await paginated(`act_${accountId}/${level==='adset'?'adsets':'ads'}`,{fields:level==='adset'?ADSET_FIELDS:'id,campaign_id,adset_id,name,status,effective_status',limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete entity inventory','META_PAGINATION_INCOMPLETE');
      return result.items;
    },
    async readReviewBreakdown({since,until,kind='device'}) {
      const allowed={device:'device_platform',placement:'publisher_platform,platform_position',country:'country'};
      if(!allowed[kind]||!/^\d{4}-\d{2}-\d{2}$/.test(since)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||since>until||Date.parse(until)-Date.parse(since)>89*86400000)throw new MetaAdsReadError('Invalid review breakdown','META_PERIOD_INVALID');
      const result=await paginated(`act_${accountId}/insights`,{level:'campaign',fields:'campaign_id,spend,impressions,inline_link_clicks',time_range:JSON.stringify({since,until}),breakdowns:allowed[kind],action_attribution_windows:JSON.stringify(['7d_click','1d_view']),action_report_time:'conversion',limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete review breakdown','META_PAGINATION_INCOMPLETE');return result.items;
    },
    async readReviewVideos({since,until}) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(since)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||since>until||Date.parse(until)-Date.parse(since)>89*86400000)throw new MetaAdsReadError('Invalid review video period','META_PERIOD_INVALID');
      const result=await paginated(`act_${accountId}/insights`,{level:'ad',fields:'ad_id,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,video_avg_time_watched_actions',time_range:JSON.stringify({since,until}),action_attribution_windows:JSON.stringify(['7d_click','1d_view']),action_report_time:'conversion',limit:100});
      if(!result.complete)throw new MetaAdsReadError('Incomplete review video evidence','META_PAGINATION_INCOMPLETE');return result.items;
    },
    async readInsights({ since, until, level = 'campaign', daily = false, extended = false }) {
      const valid = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
      if (!valid(since) || !valid(until) || since > until || Date.parse(until) - Date.parse(since) > (extended===true?89:31) * 86400000 || !['campaign', 'adset', 'ad'].includes(level)) throw new MetaAdsReadError('Invalid insight period or level', 'META_PERIOD_INVALID');
      const result = await paginated(`act_${accountId}/insights`, {
        level, fields: ['campaign_id','campaign_name', ...(level !== 'campaign' ? ['adset_id','adset_name'] : []), ...(level === 'ad' ? ['ad_id','ad_name'] : []),
          'date_start','date_stop','spend','impressions','reach','frequency','cpm','clicks','inline_link_clicks','inline_link_click_ctr','cost_per_inline_link_click','outbound_clicks','outbound_clicks_ctr','actions','action_values','purchase_roas'].join(','),
        time_range: JSON.stringify({ since, until }), ...(daily ? { time_increment: 1 } : {}),
        // One explicit reporting contract for all consumers. Never mix this with
        // legacy account-specific windows in the same fact key or comparison.
        action_attribution_windows: JSON.stringify(['7d_click', '1d_view']), action_report_time: 'conversion', limit: 100
      });
      if (!result.complete) throw new MetaAdsReadError('Incomplete insights', 'META_PAGINATION_INCOMPLETE');
      return result.items;
    },
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
