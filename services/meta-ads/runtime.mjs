import { createMetaAdsReadClient } from './meta-ads-client.mjs';
import { AdsLedger } from './ledger.mjs';
import { AdsIntelligence, LIVE_COMPILED } from './intelligence.mjs';
import { createMetaBudgetTransport } from './executor-transport.mjs';

export function createAdsRuntime({env=process.env,pool,fetchImpl=fetch}) {
  if(env.ADS_INTELLIGENCE_READ_ENABLED!=='true')return null;
  const mode=env.ADS_INTELLIGENCE_MODE||'SIMULATION',writes=env.ADS_INTELLIGENCE_WRITES_ENABLED==='true';
  if(env.META_WRITES_ENABLED==='true'||((writes||mode==='LIVE')&&(!LIVE_COMPILED||mode!=='LIVE'||!writes)))throw Error('LIVE_NOT_AUTHORIZED');
  const getNumber=(name)=>env[name]===undefined?null:Number(env[name]);
  const reader=createMetaAdsReadClient({accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,accountId:String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID||'').replace(/^act_/,''),apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0',fetchImpl});
  const ledger=new AdsLedger(pool);
  const liveCampaignIds=String(env.ADS_LIVE_CANARY_CAMPAIGN_ID||'').split(',').filter(Boolean);
  const writer=mode==='LIVE'?createMetaBudgetTransport({reader,accountId:String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID).replace(/^act_/,''),accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0',allowedCampaignIds:liveCampaignIds,mode,writesEnabled:writes}):null;
  const engine=new AdsIntelligence({reader,ledger,accountId:env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID,
    allowedActors:String(env.TELEGRAM_ALLOWED_USER_IDS||'').split(',').filter(x=>/^\d+$/.test(x)),mode,writer,
    policy:{maxBudgetCents:env.META_MAX_DAILY_BUDGET_EUR?Math.round(Number(env.META_MAX_DAILY_BUDGET_EUR)*100):null,maxChangePercent:getNumber('META_MAX_BUDGET_CHANGE_PERCENT'),minBudgetCents:1,maxAgeMs:120000,
      minSpend:getNumber('ADS_MIN_SPEND_EUR'),minPurchases:getNumber('ADS_MIN_PURCHASES'),minImpressions:getNumber('ADS_MIN_IMPRESSIONS'),minFunnelEvents:getNumber('ADS_MIN_FUNNEL_EVENTS'),liveCampaignIds}});
  const cache=new Map(),inFlight=new Map();
  return {engine,ledger,async overview({period='7d',level='campaign'}={}){
    if(!['hoy','ayer','3d','7d','30d'].includes(period)||!['campaign','adset','ad'].includes(level))throw Error('QUERY_INVALID');
    const key=period+':'+level,previous=cache.get(key);if(previous&&Date.now()-previous.at<120000)return previous.value;
    if(inFlight.has(key))return inFlight.get(key);
    const task=(async()=>{const value={...await engine.analyze({period,level}),inventory:await engine.inventory(),proposals:await ledger.history(),liveEnabled:mode==='LIVE',limits:engine.policy};cache.set(key,{at:Date.now(),value});return value;})();
    inFlight.set(key,task);try{return await task;}finally{inFlight.delete(key);}
  }};
}
