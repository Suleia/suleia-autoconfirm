import {reportReader} from './report-reader.mjs';
import {readExecutiveBudget} from './executive/budget-read.mjs';
import {ExecutiveLedger} from './executive/ledger.mjs';
import {createExecutiveService} from './executive/service.mjs';
import { createMetaAdsReadClient } from './meta-ads-client.mjs';
import { AdsLedger } from './ledger.mjs';
import { AdsIntelligence, LIVE_COMPILED } from './intelligence.mjs';
import { createMetaBudgetTransport } from './executor-transport.mjs';
import { readReport, assembleReport } from './report.mjs';
import {windowFor,CONTRACT} from './metrics.mjs';
import {captureAlgorithmEvidence} from './algorithm-reader.mjs';
import {buildAlgorithmReport,simulateBudget,traceOrders,ALGORITHM_POLICY,normalizeBudgetActivities} from './algorithm.mjs';
import {createAlgorithmOrdersReader} from './algorithm-orders.mjs';
import {createAlgorithmOperationsReader} from './algorithm-operations.mjs';
import {loadAutopilotConfig,consolidatedPolicy} from './autopilot/policy.mjs';
import {BudgetAutopilot} from './autopilot/service.mjs';
import {ownBudgetGuardAssessment,v6BudgetGuards} from './autopilot/learning.mjs';
import {isV6} from './autopilot/v6-policy.mjs';
import {madridTime} from './autopilot/schedule.mjs';
import {createReviewService} from './review/service.mjs';
import {shiftDay} from './review/periods.mjs';
import {createReportCache,reportDependencyError,ReportReadError} from './report-cache.mjs';
import {aggregateCommerce} from './review/commerce.mjs';
import {readStoredReport} from './stored-report.mjs';

export function createAdsRuntime({env=process.env,pool,fetchImpl=fetch,readOrders=null,readOperations=null,readGrowthGoals=null,reportRead=readReport,reportWaitMs=4000}) {
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
  const writesBlocked=new Set(['claimAutopilotSlot','finishAutopilotSlot','appendAlgorithmJournal','appendReviewRecord','saveRecommendation','reviewRecommendation','claimDigest','finishDigest','createProposal','claimProposal','finish','cancel','persistFacts','persistDailySnapshot','withCampaignLock','record']);
  const storedLedger=new AdsLedger(pool);
  const ledger=reportReadOnly?new Proxy(storedLedger,{get(target,key){if(writesBlocked.has(key))return async()=>{throw Error('ADS_REPORT_READ_ONLY');};const value=target[key];return typeof value==='function'?value.bind(target):value;}}):storedLedger;
  const liveCampaignIds=String(env.ADS_LIVE_CANARY_CAMPAIGN_ID||'').split(',').filter(Boolean);
  const writer=mode==='LIVE'?createMetaBudgetTransport({reader:reader.withPriority(-20),accountId:String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID).replace(/^act_/,''),accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0',allowedCampaignIds:liveCampaignIds,accountBudgetsAuthorized:liveAccountBudgets,mode,writesEnabled:writes,validateBeforeWrite:autopilotConfig.enabled&&consolidatedPolicy(autopilotConfig)}):null;
  const engine=new AdsIntelligence({reader,ledger,accountId:env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID,
    allowedActors:String(env.TELEGRAM_ALLOWED_USER_IDS||'').split(',').filter(x=>/^\d+$/.test(x)),mode,writer,
    policy:{maxBudgetCents:env.META_MAX_DAILY_BUDGET_EUR?Math.round(Number(env.META_MAX_DAILY_BUDGET_EUR)*100):null,maxChangePercent:getNumber('META_MAX_BUDGET_CHANGE_PERCENT'),minBudgetCents:1,maxAgeMs:120000,
      minSpend:getNumber('ADS_MIN_SPEND_EUR'),minPurchases:getNumber('ADS_MIN_PURCHASES'),minImpressions:getNumber('ADS_MIN_IMPRESSIONS'),minFunnelEvents:getNumber('ADS_MIN_FUNNEL_EVENTS'),liveCampaignIds,liveAccountBudgets,maxAggregateIncreaseCents:Number.isFinite(getNumber('ADS_MAX_AGGREGATE_INCREASE_EUR'))?Math.round(getNumber('ADS_MAX_AGGREGATE_INCREASE_EUR')*100):null,campaignCooldownMs:(getNumber('ADS_CAMPAIGN_COOLDOWN_HOURS')||24)*3600000}});
  let algorithmCache=null,algorithmTask=null,budgetGuardCache=null,budgetGuardTask=null,budgetOwnershipTask=null;
  // Coalesce simultaneous ownership queries only. Revalidation after a write
  // always creates a new query; no stale financial history cache is introduced.
  const ownershipHistory=()=>budgetOwnershipTask||(budgetOwnershipTask=ledger.autopilotHistory(engine.accountId,Date.now(),72*3600000).finally(()=>{budgetOwnershipTask=null;}));
  const productMappings=JSON.parse(env.ADS_VERIFIED_PRODUCT_LINKS_JSON||'[]');
  if(!Array.isArray(productMappings))throw Error('PRODUCT_LINKS_INVALID');
  const learningPolicy={...ALGORITHM_POLICY};
  // Versioned diagnostic overrides do not relax the existing monetary policy.
  if(env.ADS_LEARNING_POLICY_JSON){const configured=JSON.parse(env.ADS_LEARNING_POLICY_JSON);if(!configured.version||!/^meta-learning-v4\.[a-zA-Z0-9.-]+$/.test(configured.version))throw Error('LEARNING_POLICY_VERSION_REQUIRED');for(const k of Object.keys(configured))if(!(k in learningPolicy))throw Error('LEARNING_POLICY_INVALID');for(const[k,v]of Object.entries(configured))if(k!=='version'&&(!Number.isFinite(v)||v<=0))throw Error('LEARNING_POLICY_INVALID');Object.assign(learningPolicy,configured);}
  const ordersReader=readOrders||(env.ADS_ALGORITHM_SHOPIFY_READ_ENABLED==='true'?createAlgorithmOrdersReader({env,fetchImpl}):null);
  const operationsReader=readOperations||(env.ADS_ALGORITHM_OPERATIONS_READ_ENABLED==='true'?createAlgorithmOperationsReader({pool,hashKey:env.MIGRATION_HASH_KEY}):null);
  const sharedReportReader=reportReader(reader.withPriority(10));
  const reports=createReportCache({restore:(query,maxRangeDays)=>readStoredReport({pool,accountId:engine.accountId,query,maxRangeDays,mode}),read:(query,maxRangeDays)=>reportRead({reader:sharedReportReader,ledger:reportReadOnly?null:ledger,accountId:engine.accountId,policy:engine.policy,mode,query,maxRangeDays,...(query.level?{levels:[query.level],includeExtras:false}:{})}),waitMs:reportWaitMs,maxAgeMs:engine.policy.maxAgeMs});
  async function snapshot(query={},maxRangeDays=31){
    const range=windowFor(query.since?{since:query.since,until:query.until}:query.period||'7d',Date.now(),'Europe/Madrid',maxRangeDays);
    if(query.level&&!['campaign','adset','ad'].includes(query.level))throw Error('QUERY_INVALID');
    return reports.snapshot(`${range.since}:${range.until}:${query.level||'all'}`,query,maxRangeDays);
  }
  const reviewCache=new Map(),reviewTasks=new Map();
  async function cachedEvidence(key,fn,ttl=600000){
    const cached=reviewCache.get(key);if(cached&&Date.now()-cached.at<ttl)return cached.value;
    if(!reviewTasks.has(key)){
      if(reviewTasks.size>=12)throw Error('ADS_REVIEW_BUSY');
      const task=Promise.resolve().then(fn).then(value=>{reviewCache.set(key,{at:Date.now(),value});while(reviewCache.size>12)reviewCache.delete(reviewCache.keys().next().value);return value;}).finally(()=>reviewTasks.delete(key));reviewTasks.set(key,task);
    }
    return reviewTasks.get(key);
  }
  async function reviewExtras(range,query,{waitMs=0}={}){
    const tasks=(query.level==='ad'?['campaign','adset','ad']:['campaign','adset']).map(level=>['metadata_'+level,()=>cachedEvidence('metadata:'+level,()=>sharedReportReader.readAuditDetails(level))]);
    if(query.level==='ad')tasks.push(['creatives',()=>cachedEvidence('creatives',()=>sharedReportReader.readCreatives())]);
    if(query.detail==='true'||query.detail===true){
      tasks.push(['activities',()=>cachedEvidence(`activities:${range.since}:${range.until}`,()=>sharedReportReader.readActivityHistory({since:Date.parse(range.until)-Date.parse(range.since)>30*86400000?shiftDay(range.until,-30):range.since,until:range.until}))]);
      if(range.partial)tasks.push(['hourly',()=>cachedEvidence(`hourly:${range.until}`,()=>sharedReportReader.readHourlyTraffic({since:shiftDay(range.until,-1),until:range.until}),120000)]);
      tasks.push(['videos',()=>cachedEvidence(`videos:${range.since}:${range.until}`,()=>sharedReportReader.readReviewVideos(range))]);
      for(const kind of ['device','placement','country'])tasks.push([kind,()=>cachedEvidence(`${kind}:${range.since}:${range.until}`,()=>sharedReportReader.readReviewBreakdown({...range,kind}))]);
    }
    const out={unavailable:[],metadata:{},breakdowns:{}},pending=new Set(tasks.map(([key])=>key));
    const work=Promise.all(tasks.map(async([key,fn])=>{try{const value=await fn();if(key.startsWith('metadata_'))out.metadata[key.slice(9)]=value;else if(['device','placement','country'].includes(key))out.breakdowns[key]=value;else out[key]=value;}catch{out.unavailable.push(`META_${key.toUpperCase()}_UNAVAILABLE`);}finally{pending.delete(key);}}));
    let timer;try{await Promise.race([work,new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);}finally{clearTimeout(timer);}
    // Return the completed blocks without waiting for unrelated evidence. The
    // remaining tasks populate the same bounded cache for the next request.
    for(const key of pending)out.unavailable.push(`META_${key.toUpperCase()}_PREPARING`);
    if(Date.parse(range.until)-Date.parse(range.since)>30*86400000)out.unavailable.push('ACTIVITY_HISTORY_LIMITED_TO_LAST_31_DAYS');
    return structuredClone(out);
  }
  const runtime={engine,ledger,reportReadOnly,reportStatus:()=>({...reports.status(),requests:reader.requestStats(),reportCache:sharedReportReader.cacheStatus(),contract:CONTRACT,budgetMode:engine.mode,externalWrites:0}),algorithmEnabled:env.ADS_ALGORITHM_ENABLED==='true',async budgetGuards(){
    if(env.ADS_ALGORITHM_ENABLED!=='true')throw Error('ADS_ALGORITHM_DISABLED');
    if(budgetGuardCache&&Date.now()-Date.parse(budgetGuardCache.observedAt)<(isV6(autopilotConfig)?engine.policy.maxAgeMs:60000))return budgetGuardCache;
    if(!budgetGuardTask)budgetGuardTask=captureAlgorithmEvidence({reader,scope:'BUDGET_GUARDS'}).then(e=>{
      budgetGuardCache={...buildAlgorithmReport(e,{policy:learningPolicy}),guardEvents:normalizeBudgetActivities([...(e.currentActivities||[]),...(e.activities||[])],e.entities)};return budgetGuardCache;
    }).finally(()=>{budgetGuardTask=null;});
    return budgetGuardTask;
  },async algorithm(){
    if(env.ADS_ALGORITHM_ENABLED!=='true')throw Error('ADS_ALGORITHM_DISABLED');
    if(algorithmCache&&Date.now()-algorithmCache.at<(Object.values(algorithmCache.report.sources).some(s=>s.status!=='COMPLETE')?30000:10*60_000))return algorithmCache.report;
    if(!algorithmTask)algorithmTask=captureAlgorithmEvidence({reader:sharedReportReader,readOrders:ordersReader,readOperations:operationsReader}).then(e=>{const financial=Object.values(e.sources).find(s=>s.code==='META_FINANCIAL_WINDOW_RESERVED');if(financial)throw Object.assign(Error(financial.code),{code:financial.code});e.orders=traceOrders(e.orders,e.entities);const report={...buildAlgorithmReport(e,{policy:learningPolicy}),reportReadOnly};algorithmCache={at:Date.now(),report};return report;}).finally(()=>{algorithmTask=null;});
    // Cold reads can span many Graph pages. Keep a coalesced task, do not launch
    // a second job when Telegram retries after a bounded response.
    let timer;try{return await Promise.race([algorithmTask,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ReportReadError({source:'META_MARKETING_API',state:'PREPARING',code:'ADS_REPORT_PREPARING',connection:'READING',retryable:true,retryAfterSeconds:2,checkedAt:new Date().toISOString()})),4000);})]);}finally{clearTimeout(timer);}
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
    const base=await snapshot({period,since,until,force:query.force===true||query.force==='true'});
    const value=assembleReport({...base.dataset,productMappings,selector,filters:{level,campaignId,adsetId,adId}});
    const stale=base.readFailed||Date.now()-Date.parse(value.observedAt)>=120000;
    const budgetCandidates=!autopilotConfig.enabled&&level==='campaign'&&!stale?(value.facts||[]).filter(f=>f.delivery==='ACTIVE'&&f.roasStatus==='VALID'&&f.spend>=engine.policy.minSpend&&f.purchases>=engine.policy.minPurchases&&f.impressions>=engine.policy.minImpressions&&(f.roas>10||f.roas<3)).slice(0,3).map(f=>({campaignId:f.campaignId||f.entityId,name:f.name,direction:f.roas>10?'increase':'decrease',percent:Math.min(10,engine.policy.maxChangePercent),roas:f.roas})):[];
    if(autopilotConfig.enabled)value.autopilotPolicy={version:autopilotConfig.policy.version,increaseCents:1000,decreaseCents:1000,maxBudgetCents:autopilotConfig.policy.maxBudgetCents,roasThreshold:3.8};
    let proposals,recommendationProposals;try{[proposals,recommendationProposals]=await Promise.all([ledger.history(),ledger.recommendations()]);}catch(error){throw reportDependencyError(error);}
    return {...value,...(stale?{actions:[],opportunities:[],topAds:[],improveAds:[]}:{}),budgetCandidates,reportReadOnly,proposals,recommendationProposals,cache:{ttlMs:120000,observedAt:value.observedAt,status:stale?'STALE':'FRESH'},diagnostic:base.diagnostic,connection:{source:'META_MARKETING_API',state:stale?'DEGRADED':'CONNECTED',checkedAt:new Date().toISOString(),lastValidAt:value.observedAt,contract:value.contract}};
  },async saveRecommendation({query,actionId,principal,id,state}){
    if(state)return ledger.reviewRecommendation({id,principal,state});
    const report=await this.overview(query);if(report.cache.status!=='FRESH')throw Error('RECOMMENDATION_STALE');const action=report.actions.find(a=>a.id===actionId);
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
    const guarded=fixed?ownBudgetGuardAssessment({assessment:result,campaign,events:report.guardEvents,history:await ownershipHistory(),config:autopilotConfig,now:Date.now()}):result;
    return isV6(autopilotConfig)?{...v6BudgetGuards(guarded,report.sources),historical:null,historicalStatus:'LONG_HISTORY_NOT_REQUESTED_IN_CRITICAL_WINDOW'}:guarded;
  };
  autopilotConfig.legacy={...engine.policy};
  if(autopilotConfig.enabled&&consolidatedPolicy(autopilotConfig))engine.prepareBudgetEvidence=()=>runtime.budgetGuards();
  if(autopilotConfig.enabled)engine.policy.maxBudgetCents=Math.min(engine.policy.maxBudgetCents||autopilotConfig.policy.maxBudgetCents,autopilotConfig.policy.maxBudgetCents);
  if(autopilotConfig.enabled&&consolidatedPolicy(autopilotConfig))engine.policy.minPurchases=autopilotConfig.policy.minPurchases;
  runtime.autopilot=new BudgetAutopilot({engine,ledger,config:autopilotConfig});
  runtime.reviewEnabled=env.ADS_REVIEW_V8_ENABLED==='true'||env.ADS_REVIEW_V7_ENABLED==='true'||env.ADS_REVIEW_V6_ENABLED==='true';
  runtime.review=runtime.reviewEnabled?createReviewService({snapshot,extras:reviewExtras,ledger,productMappings,
    readCommerce:ordersReader?range=>cachedEvidence(`commerce:${range.since}:${range.until}`,async()=>aggregateCommerce(await ordersReader(range),{range,shop:env.SHOPIFY_DOMAIN||env.SHOPIFY_SHOP,observedAt:new Date().toISOString()}),120000):null,
    readGrowthGoals,budgetPolicy:{version:autopilotConfig.policy.version,policy:autopilotConfig.policy,approved:autopilotConfig.approved},maxCampaigns:Number(env.ADS_REVIEW_MAX_CAMPAIGNS||5),panelUrl:env.ADS_REVIEW_PANEL_URL||null}):null;
  runtime.executive=runtime.review?createExecutiveService({review:{...runtime.review,report:q=>runtime.review.report(q,{optionalWaitMs:7000})},ledger:new ExecutiveLedger(pool),accountId:engine.accountId,panelUrl:env.ADS_REVIEW_PANEL_URL||null,
    financialReady:async()=>{if(!isV6(autopilotConfig))return true;if(runtime.autopilot.busy||reader.requestStats().financialReservedUntil)return false;const local=madridTime();if(local.time>='22:30'&&local.time<'22:35')return (await ledger.autopilotSlots(engine.accountId,Date.now())).some(s=>s.slot_key===local.date+':22:30'&&s.state!=='EXECUTING');return true;},
    enabled:env.ADS_EXECUTIVE_DAILY_ENABLED==='true'&&!reportReadOnly,recipients:String(env.ADS_EXECUTIVE_RECIPIENT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean),
    readBudget:()=>readExecutiveBudget({ledger,accountId:engine.accountId,mode:engine.mode,config:autopilotConfig})}):null;
  if(!autopilotConfig.enabled)engine.autopilot=null;
  return runtime;
}
