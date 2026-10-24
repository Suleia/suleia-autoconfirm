import {createHash} from 'node:crypto';
import {localDay} from '../metrics.mjs';
import {reviewWindow,shiftDay} from './periods.mjs';
import {growthWindows} from './growth-periods.mjs';
import {buildGrowthFunnel,measurementStatus} from './growth-funnel.mjs';
import {buildGrowthGoal} from './growth-goals.mjs';
import {buildDailyDecisions,GROWTH_POLICY} from '../executive/daily-decisions.mjs';
import {ReportReadError} from '../report-cache.mjs';
import {buildGrowthTrend} from './growth-trend.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const metricKeys=['spend','purchases','cpa','roas','linkCtr','linkCpc','cpm','addToCart','costPerCart','initiateCheckout','costPerCheckout','purchaseValue'];
const pick=row=>row?Object.fromEntries(metricKeys.map(k=>[k,row[k]??null])):null;
const one=(r,id)=>r?.rows?.find(row=>row.entityId===id)||null;
export function createGrowthService({report,ledger,readGoals=null,now=()=>Date.now(),policy=GROWTH_POLICY,waitMs=3000}){
 const cache=new Map(),jobs=new Map();
 async function generate(query){
  const selected=await report(query),today=localDay(now());
  const anchor=selected.range.partial?shiftDay(today,-1):selected.range.until;
  const range={since:shiftDay(anchor,-29),until:anchor};
  const filters=Object.fromEntries(['campaignId','campaignIds','adsetId','adId','productId'].filter(k=>query[k]).map(k=>[k,query[k]]));
  const failures=[],byLevel={};
  for(const level of ['campaign','adset','ad']){
   try{byLevel[level]=selected.level===level&&selected.range.since===range.since&&selected.range.until===range.until?selected:await report({...filters,...range,level});}
   catch(error){if(/ADS_REPORT_PREPARING|ADS_REPORT_BUSY|META_RATE_LIMITED/.test(error.code||error.message))throw error;byLevel[level]=null;failures.push('HISTORY_'+level.toUpperCase()+'_UNAVAILABLE');}
  }
  let current=null;
  if(anchor===shiftDay(today,-1))try{current=selected.range.since===today&&selected.level==='campaign'?selected:await report({...filters,period:'hoy',level:'campaign'});}catch{failures.push('TODAY_UNAVAILABLE');}
  for(const r of Object.values(byLevel))for(const row of r?.rows||[])row.sample={...row.sample,contextVerified:Boolean(row.objective&&row.optimizationGoal)};
  const windows=Object.fromEntries(Object.entries(byLevel).map(([level,r])=>[level,growthWindows(r)]));
  const brief=buildDailyDecisions({today:current,week:windows.campaign.week,month:byLevel.campaign,adsets:windows.adset.week,ads:windows.ad.week,adsetMonth:byLevel.adset,adMonth:byLevel.ad,policy,now:now(),budget:{mode:selected.budgetMode}});
  let commerce=null;try{commerce=readGoals?await readGoals():null;}catch{failures.push('GOAL_COHORT_UNAVAILABLE');}
  const funnel=buildGrowthFunnel(selected.totals,selected.previous,{comparable:selected.comparison.comparable,minDenominator:policy.minFunnelEvents,materialDropPercent:policy.funnelDropPercent});
  const output={version:policy.version,selectedRange:selected.range,historyAnchor:anchor,observedAt:selected.observedAt,contract:selected.contract,level:selected.level,
   decisions:brief,funnel,trend:buildGrowthTrend(selected,byLevel[selected.level]),measurement:measurementStatus(selected),goal:buildGrowthGoal(commerce),failures,
   freshness:selected.freshness,temporalStatus:anchor===shiftDay(today,-1)?'CURRENT_CONTEXT':'HISTORICAL_CONTEXT',externalWrites:0,metaWrites:0,
   reads:{reader:'EXISTING_CANONICAL_META_READER',historicalWindows:'3/7/14d derived from the same30d daily facts',uniqueMetrics:'Reach/frequency are not reconstructed from daily rows'}};
  if(query.analysis==='true'||query.analysis===true){
   const id=query.adId||query.adsetId||query.campaignId;
   if(!/^\d+$/.test(id||'')||selected.rows.length!==1||selected.rows[0].entityId!==id)throw Object.assign(Error('ENTITY_SELECTION_INVALID'),{status:400});
   const row=selected.rows[0],level=selected.level;
   const decision=brief[level==='campaign'?'campaigns':level==='adset'?'adsets':'ads'].find(r=>r.id===id)||null;
   const comparisons=[];
   if(current){let period=current;if(level!=='campaign')try{period=await report({...filters,period:'hoy',level});}catch{period=null;}
    comparisons.push({key:'today',range:period?.range||null,metrics:pick(one(period,id)),comparable:false,reason:'PARTIAL_DAY_NO_EQUIVALENT_CONVERSION_CUT'});}
   for(const [key,label]of [['yesterday','Ayer'],['three','3 días completos'],['week','7 días completos'],['fortnight','14 días completos'],['month','30 días completos']]){
    const period=windows[level][key],r=one(period,id);comparisons.push({key,label,range:period?.range||null,metrics:pick(r),previous:pick(r?.prior),previousRange:period?.baselineRange||null,comparable:r?.comparable===true});
   }
   const positive=[],negative=[];
   if(row.comparable)for(const [key,direction,label]of [['roas',1,'ROAS'],['cpa',-1,'CPA'],['linkCtr',1,'CTR'],['linkCpc',-1,'CPC']]){
    const before=row.prior?.[key],after=row[key];if(!Number.isFinite(before)||!Number.isFinite(after)||before<=0)continue;
    const percent=(after-before)/before*100,entry={metric:key,label,current:after,previous:before,changePercent:percent,range:selected.range,baselineRange:selected.baselineRange};
    (percent*direction>=0?positive:negative).push(entry);
   }
   let childrenReport=selected;
   if(level!=='ad')try{childrenReport=await report({...filters,since:selected.range.since,until:selected.range.until,level:'ad'});}catch{childrenReport=null;}
   const children=(childrenReport?.rows||[]).filter(r=>level==='ad'?r.entityId===id:level==='adset'?r.adsetId===id:r.campaignId===id);
   let history={entries:[],status:'UNAVAILABLE'};
   if(ledger?.autopilotAudit)try{history={...await ledger.autopilotAudit(String(selected.account.id).replace(/^act_/,''),{campaignId:row.campaignId||id,limit:25}),status:'AVAILABLE'};}catch{}
   output.analysis={entity:{id,level,name:row.name,campaignId:row.campaignId,adsetId:row.adsetId,product:row.product,creative:row.creative,delivery:row.delivery,objective:row.objective,optimizationGoal:row.optimizationGoal},
    row,decision,comparisons,whatWorks:positive.slice(0,4),whatDoesNot:negative.slice(0,4),children,
    history,childrenRange:childrenReport?.range||null,scopeNote:'Desglose del periodo elegido; las ventanas históricas se etiquetan por separado.'};
  }
  output.evidenceDigest=hash({version:output.version,selected:selected.evidenceDigest,decisions:brief,goal:output.goal,analysis:output.analysis?.entity});
  return output;
 }
 async function get(query={}){
  reviewWindow(query,now());
  const allowed=['period','since','until','level','campaignId','campaignIds','adsetId','adId','productId','analysis','compareSince','compareUntil'];
  if(Object.keys(query).some(k=>!allowed.includes(k)))throw Error('QUERY_INVALID');
  const key=JSON.stringify(Object.entries(query).sort(([a],[b])=>a.localeCompare(b))),entry=cache.get(key);
  const preparing=code=>new ReportReadError({id:hash(['growth',key]),source:'META_MARKETING_API',state:'PREPARING',code,connection:'READING',retryable:true,retryAfterSeconds:3,checkedAt:new Date(now()).toISOString(),cache:entry?'HISTORICAL':'EMPTY'});
  if(entry&&now()-entry.at<120000)return entry.value;
  if(!jobs.has(key)){
   if(jobs.size>=2)throw preparing('ADS_REPORT_BUSY');
   const task=generate(query).then(value=>{cache.set(key,{at:now(),value});while(cache.size>12)cache.delete(cache.keys().next().value);return value;}).finally(()=>jobs.delete(key));
   task.catch(()=>{});jobs.set(key,task);
  }
  let timer;try{const value=await Promise.race([jobs.get(key),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),waitMs);})]);if(!value)throw preparing('ADS_REPORT_PREPARING');return value;}finally{clearTimeout(timer);}
 }
 return {get,pending:()=>Promise.allSettled([...jobs.values()])};
}
