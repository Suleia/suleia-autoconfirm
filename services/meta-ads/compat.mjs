import { normalizeInsight, CONTRACT, number as n } from './metrics.mjs';
// Stable legacy field names; values and provenance come from the canonical
// normalizer. Original all-click CTR/CPC retain their names for compatibility.
export function legacyInsight(row,level='campaign') {
  const m=normalizeInsight(row,{level,contract:CONTRACT,complete:true,observedAt:new Date().toISOString()});
  return {campaignId:row.campaign_id||'',campaignName:row.campaign_name||'',adsetId:row.adset_id||'',adsetName:row.adset_name||'',adId:row.ad_id||'',adName:row.ad_name||'',dateStart:m.since,dateStop:m.until,
    spend:m.spend,impressions:m.impressions,reach:m.reach,clicks:n(row.clicks),ctr:m.impressions&&n(row.clicks)!==null?n(row.clicks)/m.impressions*100:null,cpc:n(row.clicks)?m.spend/n(row.clicks):null,cpm:m.cpm,
    purchases:m.purchases,purchaseValue:m.purchaseValue,costPerPurchase:m.cpa,roas:m.roas,roasStatus:m.roasStatus,linkCtr:m.linkCtr,linkCpc:m.linkCpc,contract:CONTRACT,source:'META_INSIGHTS'};
}
export async function readLegacyInsights(reader,{since,until,level='campaign',timeIncrement=null}) {
  if(timeIncrement&&timeIncrement!==1&&timeIncrement!=='1')throw Error('CANONICAL_DAILY_INCREMENT_REQUIRED');
  const rows=[];
  for(let cursor=since;cursor<=until;){
    const end=new Date(Math.min(Date.parse(until),Date.parse(cursor)+30*86400000)).toISOString().slice(0,10);
    if(end<until&&!timeIncrement)throw Error('AGGREGATE_PERIOD_EXCEEDS_31_DAYS');
    rows.push(...await reader.readInsights({since:cursor,until:end,level,daily:!!timeIncrement}));
    cursor=new Date(Date.parse(end)+86400000).toISOString().slice(0,10);
  }
  const normalized=rows.map(row=>legacyInsight(row,level));
  // Existing finance consumers sum absent spend as zero. Fail closed at the
  // compatibility boundary instead of silently changing their report semantics.
  if(!normalized.length||normalized.some(r=>r.spend===null))throw Error('CANONICAL_SPEND_UNAVAILABLE');
  return normalized;
}
