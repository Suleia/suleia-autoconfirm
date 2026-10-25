import {MAX_CAMPAIGN_DAILY_BUDGET_CENTS} from '../budget-cap.mjs';
import {CONTRACT} from '../metrics.mjs';
import {madridTime,instantFor} from './schedule.mjs';

export const V6_VERSION='SULEIA_META_AUTOPILOT_V6';
export const V6_PROFILE='V6_FIXED_EUR';
export const isV6=config=>config?.approved?.policyProfile===V6_PROFILE;
export const V6_POLICY=Object.freeze({version:V6_VERSION,roasThreshold:3.8,reductionRoasThreshold:2.5,
  increaseCents:1000,maxBudgetCents:MAX_CAMPAIGN_DAILY_BUDGET_CENTS,minPurchases:3,maxIncreasesPerDay:4,
  maxDayReductionBps:2500,nightReductionBps:3000,maxAgeMs:120000,rankingWeights:{today:.7,recent:.2,historical:.1}});
const valid=n=>Number.isSafeInteger(n)&&n>0;
const usedState=s=>['VERIFIED','RECONCILED','EXECUTING','UNKNOWN'].includes(s);
export function v6History(history,id,now){
  const day=madridTime(now).date;
  return history.filter(p=>madridTime(p.createdAt).date===day).flatMap(p=>(p.items||[]).filter(i=>i.campaignId===id&&usedState(i.result?.state)).map(i=>({proposal:p,item:i}))).sort((a,b)=>a.proposal.createdAt-b.proposal.createdAt);
}
export function v6NightTarget(before,minimum){
  if(!valid(before)||!valid(minimum)||minimum>MAX_CAMPAIGN_DAILY_BUDGET_CENTS)return null;
  return Math.min(MAX_CAMPAIGN_DAILY_BUDGET_CENTS,Math.max(minimum,Math.round(before*70/100)));
}
function freshMetric(m,now){const day=madridTime(now).date,age=now-Date.parse(m?.observedAt);return m?.complete===true&&m.since===day&&m.until===day&&age>=-5000&&age<=V6_POLICY.maxAgeMs&&m.contract===CONTRACT;}
function newPurchaseProof(proof,{campaign,metric,last,now}){
  if(!proof||proof.verified!==true||proof.campaignId!==String(campaign.id)||proof.accountId!==String(campaign.account_id)||
    proof.contract!==metric.contract||proof.purchaseType!==metric.purchaseType||proof.businessDate!==madridTime(now).date||
    !Number.isFinite(Date.parse(proof.observedAt))||now-Date.parse(proof.observedAt)>V6_POLICY.maxAgeMs||Date.parse(proof.observedAt)>now+5000||!Array.isArray(proof.events))return null;
  const after=Number(last.item.result?.verifiedAt);
  if(!Number.isFinite(after)||!proof.source||proof.source==='META_AGGREGATE_DELTA')return null;
  const ids=new Set();
  for(const e of proof.events){
    const at=Date.parse(e.conversionAt);
    if(!/^[a-f0-9]{64}$/.test(e.idHash||'')||ids.has(e.idHash)||!Number.isFinite(at)||at<=after||at>now||
       madridTime(at).date!==madridTime(now).date||e.attributionVerified!==true)return null;
    ids.add(e.idHash);
  }
  return ids.size;
}
export function evaluateV6({campaign,metric,slot,now,config,history=[],constraints,accountSpend,baseline=null,purchaseProof=null,trend=null}){
 const id=String(campaign.id),before=Number(campaign.daily_budget),local=madridTime(now),reasons=[],warnings=[];
 const h=v6History(history,id,now),increases=h.filter(x=>x.item.after>x.item.before),last=increases.at(-1);
 const minimum=constraints?.perCampaign?constraints.perCampaign[id]:constraints;
 const operating=Math.max(config.approved.minimumBudgetCents||0,minimum?.minimumCents||0);
 let after=before,action='HOLD',rule='HOLD',newPurchases=null;
 if(!valid(before)||Number(campaign.lifetime_budget)>0)reasons.push('CAMPAIGN_DAILY_BUDGET_REQUIRED');
 if(campaign.status!=='ACTIVE'||campaign.effective_status!=='ACTIVE')reasons.push('CAMPAIGN_INACTIVE');
 if(slot?.date!==local.date)reasons.push('FUTURE_DAY_METRICS_REQUIRED');
 if(before>10000)warnings.push('EXTERNAL_BUDGET_ABOVE_100');
 const fresh=freshMetric(metric,now),known=fresh&&['VALID','ZERO'].includes(metric.metaRoasStatus)&&Number.isFinite(metric.metaRoas)&&metric.metaRoas>=0;
 if(slot?.kind==='OBSERVE'){rule='OBSERVE_NO_RESTORE';}
 else if(slot?.kind==='NIGHT'){
  rule='NIGHT_22_30';after=v6NightTarget(before,operating)??before;
  if(after<before)action='NIGHT_DECREASE';
  else if(after>before){after=before;reasons.push('OPERATING_MINIMUM_ABOVE_CURRENT_BUDGET');}
  if(h.some(x=>x.proposal.autopilot?.slot?.kind==='NIGHT'&&x.proposal.autopilot?.version===V6_VERSION))reasons.push('NIGHT_ALREADY_CLAIMED');
 }else if(!fresh)reasons.push('AUTOPILOT_STALE_OR_WRONG_DAY');
 else if(!known)reasons.push(metric?.metaRoasStatus==='AMBIGUOUS'?'ROAS_AMBIGUOUS':'ROAS_MISSING');
 else if(metric.metaRoas>3.8&&['10:00','12:00','16:00','18:00'].includes(slot?.time)){
  rule='V6_INTRADAY_SCALE';
  if(before<10000){after=Math.min(before+1000,10000);action='INCREASE';}else reasons.push('MAX_BUDGET');
  if(increases.length>=4)reasons.push('FOUR_INCREASES_USED');
  if(!Number.isSafeInteger(metric.purchases)||metric.purchases<3)reasons.push('MIN_THREE_PURCHASES');
  if(metric.metaRoasPurchaseType!==metric.purchaseType||!metric.purchaseType)reasons.push('ROAS_SCOPE_MISMATCH');
  if(metric.spend<config.legacy.minSpend||metric.impressions<config.legacy.minImpressions)reasons.push('INSUFFICIENT_SAMPLE');
  if(!valid(config.legacy.minSpend)||!valid(config.legacy.minImpressions))reasons.push('SAMPLE_POLICY_NOT_CONFIGURED');
  if(last){
   const old=last.item.metric;
   if(old?.contract!==metric.contract||old?.purchaseType!==metric.purchaseType)reasons.push('INCREMENTAL_SCOPE_CHANGED');
   if(metric.purchases-(old?.purchases??Infinity)<3)reasons.push('CONVERSIONS_ALREADY_USED');
   if(metric.spend<(old?.spend??0)||metric.purchaseValue<(old?.purchaseValue??0))reasons.push('ATTRIBUTION_REVISION');
   newPurchases=newPurchaseProof(purchaseProof,{campaign,metric,last,now});
   if(newPurchases===null)reasons.push('INCREMENTAL_PURCHASE_PROVENANCE_UNVERIFIED');
   else if(newPurchases<3)reasons.push('CONVERSIONS_ALREADY_USED');
  }
  if(!accountSpend?.complete||!Number.isSafeInteger(accountSpend.spendCents)||accountSpend.spendCents<0||accountSpend.date!==local.date||!Number.isFinite(Date.parse(accountSpend.observedAt))||now-Date.parse(accountSpend.observedAt)>120000||Date.parse(accountSpend.observedAt)>now+5000)reasons.push('ACCOUNT_SPEND_UNVERIFIED');
  if(config.approved.globalSpendLimitMode!=='UNLIMITED_AUTHORIZED'&&(!valid(config.approved.globalSpendLimitCents)||accountSpend?.spendCents>=config.approved.globalSpendLimitCents))reasons.push('ACCOUNT_SPEND_LIMIT_REACHED');
 }else if(metric.metaRoas<2.5&&['12:00','16:00','18:00'].includes(slot?.time)){
  rule='V6_INTRADAY_REDUCTION';
  if(config.approved.roasReductionMode!=='ENABLED')reasons.push('ROAS_REDUCTIONS_NOT_AUTHORIZED');
  if(![config.approved.reductionMinSpend,config.approved.reductionMinImpressions,config.approved.attributionMaturityMinutes].every(v=>Number.isFinite(v)&&v>0))reasons.push('REDUCTION_SAMPLE_POLICY_NOT_APPROVED');
  const base=baseline?.budgets?.[id],bp=slot.time==='18:00'?500:1000;
  const used=h.filter(x=>x.proposal.autopilot?.slot?.kind!=='NIGHT'&&x.item.after<x.item.before).reduce((s,x)=>s+x.item.before-x.item.after,0);
  if(baseline?.date!==local.date||baseline.verified!==true||!valid(base))reasons.push('DAY_BASELINE_UNVERIFIED');
  else{const remaining=Math.max(0,Math.floor(base*.25)-used),cut=Math.min(Math.round(base*bp/10000),remaining);after=Math.max(operating,before-cut);if(after<before)action='DECREASE';}
  const lastChange=Math.max(instantFor(local.date,'00:00'),...h.map(x=>x.item.result?.verifiedAt||x.proposal.createdAt));
  if(metric.spend<config.approved.reductionMinSpend||metric.impressions<config.approved.reductionMinImpressions||now-lastChange<config.approved.attributionMaturityMinutes*60000)reasons.push('REDUCTION_SAMPLE_INSUFFICIENT');
  if(!metric.purchaseType||metric.metaRoasPurchaseType!==metric.purchaseType)reasons.push('ROAS_SCOPE_MISMATCH');
  if(trend?.recovering===true)reasons.push('INTRADAY_RECOVERY_PROTECTED');
  if(!trend?.verified)reasons.push('INTRADAY_TREND_UNVERIFIED');
 }
 if(action!=='HOLD'){
  if(config.approved.authorizationExpiresAt&&Date.parse(config.approved.authorizationExpiresAt)<=now)reasons.push('AUTOPILOT_AUTHORIZATION_EXPIRED');
  if(!minimum?.verified||!valid(minimum.minimumCents)||Date.parse(minimum.validUntil||'9999-01-01')<now)reasons.push('META_MINIMUM_NOT_VERIFIED');
  if(!valid(config.approved.minimumBudgetCents)||after<operating)reasons.push('META_MINIMUM_CONFLICT');
  if(!valid(after)||after>10000||after===before)reasons.push('BUDGET_INVALID_OR_UNCHANGED');
  if(h.some(x=>['EXECUTING','UNKNOWN','RECONCILED'].includes(x.item.result?.state)))reasons.push('UNRESOLVED_OPERATION');
  if(slot.kind!=='NIGHT'&&h.some(x=>x.proposal.origin!=='AUTOPILOT'))reasons.push('MANUAL_HOLD_UNTIL_NIGHT');
 }
 const classification=trend?.recovering?'RECUPERACION_DETECTADA':known&&metric.metaRoas>3.8?'OPORTUNIDAD_DE_ESCALADO':known&&metric.metaRoas<2.5?'CANDIDATA_A_REDUCCION':'MANTENER';
 return {campaignId:id,name:campaign.name,before,after,action,rule,metric:metric||null,reasons:[...new Set(reasons)],warnings,
  state:reasons.length?'BLOCKED':action==='HOLD'?'HOLD':'VALIDATED',classification,trend:trend||null,newPurchases,
  incrementsToday:increases.length,changesToday:h.length,verifiedChangesToday:h.filter(x=>x.item.result.state==='VERIFIED').length,
  lastChangeAt:h.filter(x=>x.item.result.state==='VERIFIED').at(-1)?.item.result.verifiedAt??null,
  nightTargetCents:v6NightTarget(before,operating),effectiveReductionBps:before>0&&after<before?Math.round((before-after)*10000/before):0,
  costControls:{cpa:metric?.purchases>0&&Number.isFinite(metric.spend)?metric.spend/metric.purchases:null,costPerCart:metric?.addToCart>0&&Number.isFinite(metric.spend)?metric.spend/metric.addToCart:null,compatibleHistory:trend?.verified===true}};
}

export function intradayTrend(metric,previous,now){
 if(!freshMetric(metric,now)||!previous||previous.contract!==metric.contract||previous.purchaseType!==metric.purchaseType||previous.since!==metric.since||
   !['VALID','ZERO'].includes(previous.metaRoasStatus)||!Number.isFinite(previous.metaRoas)||!Number.isFinite(previous.spend)||!Number.isFinite(previous.purchaseValue)||
   Date.parse(previous.observedAt)>=Date.parse(metric.observedAt)||metric.spend<previous.spend||metric.purchaseValue<previous.purchaseValue)return {verified:false,recovering:null};
 const deltaSpend=metric.spend-previous.spend,deltaValue=metric.purchaseValue-previous.purchaseValue;
 const marginalRoas=deltaSpend>0?deltaValue/deltaSpend:null;
 return {verified:true,recovering:metric.metaRoas>previous.metaRoas&&marginalRoas!==null&&marginalRoas>2.5,
   previousRoas:previous.metaRoas,marginalRoas,since:previous.observedAt};
}

// Rank normalized scores, never average ROAS values or relax financial guards.
export function rankV6({today=null,recent=null,historical=null}={}){
 const values=[today,recent,historical];if(values.some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>1)))throw Error('V6_RANK_INPUT_INVALID');
 const weights=[.7,.2,.1],sum=weights.reduce((s,w,i)=>s+(values[i]===null?0:w),0);
 return {score:sum?weights.reduce((s,w,i)=>s+(values[i]===null?0:w*values[i]),0)/sum:null,weights:V6_POLICY.rankingWeights,missing:['today','recent','historical'].filter((_,i)=>values[i]===null)};
}
