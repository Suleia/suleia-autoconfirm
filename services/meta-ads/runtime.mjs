import { createMetaAdsReadClient } from './meta-ads-client.mjs';
import { AdsLedger } from './ledger.mjs';
import { AdsIntelligence, LIVE_COMPILED } from './intelligence.mjs';
import { createMetaBudgetTransport } from './executor-transport.mjs';
import { readReport, assembleReport } from './report.mjs';
import {windowFor} from './metrics.mjs';

export function createAdsRuntime({env=process.env,pool,fetchImpl=fetch}) {
  if(env.ADS_INTELLIGENCE_READ_ENABLED!=='true')return null;
  const mode=env.ADS_INTELLIGENCE_MODE||'SIMULATION',writes=env.ADS_INTELLIGENCE_WRITES_ENABLED==='true';
  if(env.META_WRITES_ENABLED==='true'||((writes||mode==='LIVE')&&(!LIVE_COMPILED||mode!=='LIVE'||!writes)))throw Error('LIVE_NOT_AUTHORIZED');
  const getNumber=(name)=>env[name]===undefined||String(env[name]).trim()===''?null:Number(env[name]);
  const reader=createMetaAdsReadClient({accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,accountId:String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID||'').replace(/^act_/,''),apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0',fetchImpl});
  const ledger=new AdsLedger(pool);
  const liveCampaignIds=String(env.ADS_LIVE_CANARY_CAMPAIGN_ID||'').split(',').filter(Boolean);
  const writer=mode==='LIVE'?createMetaBudgetTransport({reader,accountId:String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID).replace(/^act_/,''),accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0',allowedCampaignIds:liveCampaignIds,mode,writesEnabled:writes}):null;
  const engine=new AdsIntelligence({reader,ledger,accountId:env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID,
    allowedActors:String(env.TELEGRAM_ALLOWED_USER_IDS||'').split(',').filter(x=>/^\d+$/.test(x)),mode,writer,
    policy:{maxBudgetCents:env.META_MAX_DAILY_BUDGET_EUR?Math.round(Number(env.META_MAX_DAILY_BUDGET_EUR)*100):null,maxChangePercent:getNumber('META_MAX_BUDGET_CHANGE_PERCENT'),minBudgetCents:1,maxAgeMs:120000,
      minSpend:getNumber('ADS_MIN_SPEND_EUR'),minPurchases:getNumber('ADS_MIN_PURCHASES'),minImpressions:getNumber('ADS_MIN_IMPRESSIONS'),minFunnelEvents:getNumber('ADS_MIN_FUNNEL_EVENTS'),liveCampaignIds}});
  const cache=new Map(),inFlight=new Map();
  return {engine,ledger,async overview(query={}){
    const {period='7d',level='campaign',since,until,selector,campaignId,adsetId,adId}=query;
    if(Boolean(since)!==Boolean(until)||(!since&&!['hoy','ayer','3d','7d','30d'].includes(period))||!['campaign','adset','ad'].includes(level)||[campaignId,adsetId,adId].some(id=>id&&!/^\d+$/.test(id))||(selector&&(typeof selector!=='string'||selector.length>100))||query.productId)throw Error('QUERY_INVALID');
    windowFor(since?{since,until}:period,Date.now());
    const key=since?`${since}:${until}`:period;
    let base=cache.get(key);
    if(!base||Date.now()-base.at>=120000){
      if(!inFlight.has(key)){
        if(inFlight.size>=2)throw Error('ADS_REPORT_BUSY');
        const task=readReport({reader,ledger,accountId:engine.accountId,policy:engine.policy,mode,query:{period,since,until}}).then(value=>{const entry={at:Date.now(),value};cache.delete(key);cache.set(key,entry);while(cache.size>8)cache.delete(cache.keys().next().value);return entry;}).finally(()=>inFlight.delete(key));
        inFlight.set(key,task);
      }
      base=await inFlight.get(key);
    }
    const value=assembleReport({...base.value.dataset,selector,filters:{level,campaignId,adsetId,adId}});
    return {...value,proposals:await ledger.history(),recommendationProposals:await ledger.recommendations(),cache:{ttlMs:120000,observedAt:value.observedAt}};
  },async saveRecommendation({query,actionId,principal,id,state}){
    if(state)return ledger.reviewRecommendation({id,principal,state});
    const report=await this.overview(query),action=report.actions.find(a=>a.id===actionId);
    if(!action)throw Error('RECOMMENDATION_STALE');
    return ledger.saveRecommendation({action,principal,accountId:engine.accountId});
  }};
}
