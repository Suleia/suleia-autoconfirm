import { createMetaAdsReadClient } from './meta-ads-client.mjs';
import { AdsLedger } from './ledger.mjs';
import { AdsIntelligence, LIVE_COMPILED } from './intelligence.mjs';
import { createMetaBudgetTransport } from './executor-transport.mjs';
import { readReport, assembleReport } from './report.mjs';
import {windowFor} from './metrics.mjs';
import {captureAlgorithmEvidence} from './algorithm-reader.mjs';
import {buildAlgorithmReport,simulateBudget,traceOrders,ALGORITHM_POLICY,normalizeBudgetActivities} from './algorithm.mjs';
import {createAlgorithmOrdersReader} from './algorithm-orders.mjs';
import {createAlgorithmOperationsReader} from './algorithm-operations.mjs';
import {loadAutopilotConfig,consolidatedPolicy} from './autopilot/policy.mjs';
import {BudgetAutopilot} from './autopilot/service.mjs';
import {ownBudgetGuardAssessment} from './autopilot/learning.mjs';

export function createAdsRuntime({env=process.env,pool,fetchImpl=fetch,readOrders=null,readOperations=null}) {
  if(env.ADS_INTELLIGENCE_READ_ENABLED!=='true')return null;
  const autopilotConfig=loadAutopilotConfig(env);
  const mode=autopilotConfig.enabled?autopilotConfig.mode:env.ADS_INTELLIGENCE_MODE||'SIMULATION',writes=env.ADS_INTELLIGENCE_WRITES_ENABLED==='true';
  const liveAccountBudgets=env.ADS_LIVE_ACCOUNT_BUDGETS_ENABLED==='true';
  if(mode==='LIVE'&&(env.ADS_LIVE_BUDGETS_AUTHORIZED!=='true'||!Number.isFinite(Number(env.ADS_MAX_AGGREGATE_INCREASE_EUR))||Number(env.ADS_MAX_AGGREGATE_INCREASE_EUR)<=0||!Number.isFinite(Number(env.ADS_CAMPAIGN_COOLDOWN_HOURS))||Number(env.ADS_CAMPAIGN_COOLDOWN_HOURS)<24||![env.ADS_MIN_SPEND_EUR,env.ADS_MIN_PURCHASES,env.ADS_MIN_IMPRESSIONS].every(x=>Number.isFinite(Number(x))&&Number(x)>0)))throw Error('LIVE_NOT_AUTHORIZED');
  if(env.META_WRITES_ENABLED==='true'||((writes||mode==='LIVE')&&(!LIVE_COMPILED||mode!=='LIVE'||!writes)))throw Error('LIVE_NOT_AUTHORIZED');
  const getNumber=(name)=>env[name]===undefined||String(env[name]).trim()===''?null:Number(env[name]);
  const reader=createMetaAdsReadClient({accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,accountId:String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID||'').replace(/^act_/,''),apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0',fetchImpl});
  const reportReadOnly=env.ADS_REPORT_READ_ONLY==='true';
  if(autopilotConfig.enabled&&reportReadOnly)throw Error('AUTOPILOT_REQUIRES_APPROVED_ADS_PERSISTENCE');
  const writesBlocked=new Set(['claimAutopilotSlot','finishAutopilotSlot','appendAlgorithmJournal','saveRecommendation','reviewRecommendation','claimDigest','finishDigest','createProposal','claimProposal','finish','cancel','persistFacts','persistDailySnapshot','withCampaignLock','record']);
  const storedLedger=new AdsLedger(pool);
  const ledger=reportReadOnly?new Proxy(storedLedger,{get(target,key){if(writesBlocked.has(key))return async()=>{throw Error('ADS_REPORT_READ_ONLY');};const value=target[key];return typeof value==='function'?value.bind(target):value;}}):storedLedger;
  const liveCampaignIds=String(env.ADS_LIVE_CANARY_CAMPAIGN_ID||'').split(',').filter(Boolean);
  const writer=mode==='LIVE'?createMetaBudgetTransport({reader,accountId:String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID).replace(/^act_/,''),accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0',allowedCampaignIds:liveCampaignIds,accountBudgetsAuthorized:liveAccountBudgets,mode,writesEnabled:writes,validateBeforeWrite:autopilotConfig.enabled&&consolidatedPolicy(autopilotConfig)}):null;
  const engine=new AdsIntelligence({reader,ledger,accountId:env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID,
    allowedActors:String(env.TELEGRAM_ALLOWED_USER_IDS||'').split(',').filter(x=>/^\d+$/.test(x)),mode,writer,
    policy:{maxBudgetCents:env.META_MAX_DAILY_BUDGET_EUR?Math.round(Number(env.META_MAX_DAILY_BUDGET_EUR)*100):null,maxChangePercent:getNumber('META_MAX_BUDGET_CHANGE_PERCENT'),minBudgetCents:1,maxAgeMs:120000,
      minSpend:getNumber('ADS_MIN_SPEND_EUR'),minPurchases:getNumber('ADS_MIN_PURCHASES'),minImpressions:getNumber('ADS_MIN_IMPRESSIONS'),minFunnelEvents:getNumber('ADS_MIN_FUNNEL_EVENTS'),liveCampaignIds,liveAccountBudgets,maxAggregateIncreaseCents:Number.isFinite(getNumber('ADS_MAX_AGGREGATE_INCREASE_EUR'))?Math.round(getNumber('ADS_MAX_AGGREGATE_INCREASE_EUR')*100):null,campaignCooldownMs:(getNumber('ADS_CAMPAIGN_COOLDOWN_HOURS')||24)*3600000}});
  const cache=new Map(),inFlight=new Map();let algorithmCache=null,algorithmTask=null,budgetGuardCache=null,budgetGuardTask=null;
  const productMappings=JSON.parse(env.ADS_VERIFIED_PRODUCT_LINKS_JSON||'[]');
  if(!Array.isArray(productMappings))throw Error('PRODUCT_LINKS_INVALID');
  const learningPolicy={...ALGORITHM_POLICY};
  // Versioned diagnostic overrides do not relax the existing monetary policy.
  if(env.ADS_LEARNING_POLICY_JSON){const configured=JSON.parse(env.ADS_LEARNING_POLICY_JSON);if(!configured.version||!/^meta-learning-v4\.[a-zA-Z0-9.-]+$/.test(configured.version))throw Error('LEARNING_POLICY_VERSION_REQUIRED');for(const k of Object.keys(configured))if(!(k in learningPolicy))throw Error('LEARNING_POLICY_INVALID');for(const[k,v]of Object.entries(configured))if(k!=='version'&&(!Number.isFinite(v)||v<=0))throw Error('LEARNING_POLICY_INVALID');Object.assign(learningPolicy,configured);}
  const ordersReader=readOrders||(env.ADS_ALGORITHM_SHOPIFY_READ_ENABLED==='true'?createAlgorithmOrdersReader({env,fetchImpl}):null);
  const operationsReader=readOperations||(env.ADS_ALGORITHM_OPERATIONS_READ_ENABLED==='true'?createAlgorithmOperationsReader({pool,hashKey:env.MIGRATION_HASH_KEY}):null);
  const runtime={engine,ledger,reportReadOnly,algorithmEnabled:env.ADS_ALGORITHM_ENABLED==='true',async budgetGuards(){
    if(env.ADS_ALGORITHM_ENABLED!=='true')throw Error('ADS_ALGORITHM_DISABLED');
    if(budgetGuardCache&&Date.now()-Date.parse(budgetGuardCache.observedAt)<60000)return budgetGuardCache;
    if(!budgetGuardTask)budgetGuardTask=captureAlgorithmEvidence({reader,scope:'BUDGET_GUARDS'}).then(e=>{
      budgetGuardCache={...buildAlgorithmReport(e,{policy:learningPolicy}),guardEvents:normalizeBudgetActivities([...(e.currentActivities||[]),...(e.activities||[])],e.entities)};return budgetGuardCache;
    }).finally(()=>{budgetGuardTask=null;});
    return budgetGuardTask;
  },async algorithm(){
    if(env.ADS_ALGORITHM_ENABLED!=='true')throw Error('ADS_ALGORITHM_DISABLED');
    if(algorithmCache&&Date.now()-algorithmCache.at<10*60_000)return algorithmCache.report;
    if(!algorithmTask)algorithmTask=captureAlgorithmEvidence({reader,readOrders:ordersReader,readOperations:operationsReader}).then(e=>{e.orders=traceOrders(e.orders,e.entities);const report={...buildAlgorithmReport(e,{policy:learningPolicy}),reportReadOnly};algorithmCache={at:Date.now(),report};return report;}).finally(()=>{algorithmTask=null;});
    // Cold reads can span many Graph pages. Keep a coalesced task, do not launch
    // a second job when Telegram retries after a bounded response.
    return algorithmTask;
  },async simulate(query){
    if(!query||!/^\d+$/.test(String(query.campaignId))||!Number.isSafeInteger(query.newBudgetCents)||!Number.isInteger(query.days))throw Error('QUERY_INVALID');
    const report=await this.algorithm(),assessment=report.campaigns.find(c=>c.campaignId===String(query.campaignId));
    if(!assessment)throw Error('QUERY_INVALID');
    return simulateBudget({campaign:{id:assessment.campaignId,daily_budget:assessment.budgetCents},assessment,newBudgetCents:query.newBudgetCents,days:query.days,currentLimits:engine.policy});
  },async journalHistory(){return ledger.algorithmJournal();
  },async journal({eventType,reference,principal}){
    if(!['DIAGNOSIS','RECOMMENDATION','APPROVED','REJECTED','FALSE_POSITIVE','OBSERVATION','EXPERIMENT_DESIGN'].includes(eventType)||typeof reference!=='string'||reference.length>100)throw Error('QUERY_INVALID');
    const report=await this.algorithm();
    if(reference!=='ACCOUNT'&&!report.campaigns.some(c=>c.campaignId===reference))throw Error('QUERY_INVALID');
    return ledger.appendAlgorithmJournal({eventType,reference,principal,report});
  },async overview(query={}){
    const {period='7d',level='campaign',since,until,selector,campaignId,adsetId,adId}=query;
    if(Boolean(since)!==Boolean(until)||(!since&&!['hoy','ayer','3d','7d','30d'].includes(period))||!['campaign','adset','ad'].includes(level)||[campaignId,adsetId,adId].some(id=>id&&!/^\d+$/.test(id))||(selector&&(typeof selector!=='string'||selector.length>100))||query.productId)throw Error('QUERY_INVALID');
    const window=windowFor(since?{since,until}:period,Date.now());
    const key=`${window.since}:${window.until}`;
    let base=cache.get(key);
    let stale=false;
    if(query.force===true||!base||Date.now()-Date.parse(base.value.observedAt)>=120000){
      if(!inFlight.has(key)){
        if(inFlight.size>=2)throw Error('ADS_REPORT_BUSY');
        const task=readReport({reader,ledger:reportReadOnly?null:ledger,accountId:engine.accountId,policy:engine.policy,mode,query:{period,since,until}}).then(value=>{const entry={at:Date.now(),value};cache.delete(key);cache.set(key,entry);while(cache.size>8)cache.delete(cache.keys().next().value);return entry;}).finally(()=>inFlight.delete(key));
        inFlight.set(key,task);
      }
      let timer;
      try {base=await Promise.race([inFlight.get(key),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ADS_REPORT_TIMEOUT')),4000);})]);}
      catch {if(!base)throw Error('META_REPORT_PREPARING_OR_UNAVAILABLE');stale=true;}
      finally {clearTimeout(timer);}
    }
    const value=assembleReport({...base.value.dataset,productMappings,selector,filters:{level,campaignId,adsetId,adId}});
    stale ||= Date.now()-Date.parse(value.observedAt)>=120000;
    const budgetCandidates=!autopilotConfig.enabled&&level==='campaign'&&!stale?(value.facts||[]).filter(f=>f.delivery==='ACTIVE'&&f.roasStatus==='VALID'&&f.spend>=engine.policy.minSpend&&f.purchases>=engine.policy.minPurchases&&f.impressions>=engine.policy.minImpressions&&(f.roas>10||f.roas<3)).slice(0,3).map(f=>({campaignId:f.campaignId||f.entityId,name:f.name,direction:f.roas>10?'increase':'decrease',percent:Math.min(10,engine.policy.maxChangePercent),roas:f.roas})):[];
    if(autopilotConfig.enabled)value.autopilotPolicy={version:autopilotConfig.policy.version,increaseCents:1000,decreaseCents:1000,maxBudgetCents:7000,roasThreshold:3.8};
    return {...value,budgetCandidates,reportReadOnly,proposals:await ledger.history(),recommendationProposals:await ledger.recommendations(),cache:{ttlMs:120000,observedAt:value.observedAt,status:stale?'STALE':'FRESH'}};
  },async saveRecommendation({query,actionId,principal,id,state}){
    if(state)return ledger.reviewRecommendation({id,principal,state});
    const report=await this.overview(query),action=report.actions.find(a=>a.id===actionId);
    if(!action)throw Error('RECOMMENDATION_STALE');
    return ledger.saveRecommendation({action,principal,accountId:engine.accountId});
  }};
  engine.learningAssessment=async(campaign)=>{
    if(env.ADS_ALGORITHM_ENABLED!=='true')return {reasons:['LEARNING_EVIDENCE_NOT_ENABLED'],policy:learningPolicy};
    const fixed=autopilotConfig.enabled&&consolidatedPolicy(autopilotConfig);
    if(!fixed&&algorithmCache&&Date.now()-Date.parse(algorithmCache.report.observedAt)>=engine.policy.maxAgeMs)algorithmCache=null;
    const report=fixed?await runtime.budgetGuards():await runtime.algorithm(),assessment=report.campaigns.find(c=>c.campaignId===String(campaign.id));
    if(!assessment)return {reasons:['LEARNING_EVIDENCE_MISSING'],policy:learningPolicy};
    // Explicit, confirmed budget instructions do not assert profitability.
    // Keep the diagnostic abstention and every operational learning protection.
    const result={...assessment,reasons:assessment.reasons.filter(r=>r!=='VERIFIED_ECONOMICS_MISSING'),warnings:assessment.reasons.includes('VERIFIED_ECONOMICS_MISSING')?['Margen y ROAS de equilibrio no acreditados; este cambio no implica rentabilidad.']:[]};
    return fixed?ownBudgetGuardAssessment({assessment:result,campaign,events:report.guardEvents,history:await ledger.autopilotHistory(engine.accountId,Date.now(),72*3600000),config:autopilotConfig,now:Date.now()}):result;
  };
  autopilotConfig.legacy={...engine.policy};
  if(autopilotConfig.enabled)engine.policy.maxBudgetCents=Math.min(engine.policy.maxBudgetCents||7000,7000);
  if(autopilotConfig.enabled&&consolidatedPolicy(autopilotConfig))engine.policy.minPurchases=autopilotConfig.policy.minPurchases;
  runtime.autopilot=new BudgetAutopilot({engine,ledger,config:autopilotConfig});
  if(!autopilotConfig.enabled)engine.autopilot=null;
  return runtime;
}
