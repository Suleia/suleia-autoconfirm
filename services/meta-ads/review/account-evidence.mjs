import {normalizeInsight,CONTRACT} from '../metrics.mjs';
import {sourceReadAt} from '../report-reader.mjs';

// Reporting only: a provider account scope avoids adding overlapping reach.
// No missing event is treated as zero merely because Meta omitted it. A zero
// can be deduced only when independent account totals exactly exhaust the
// known nonnegative campaign events, in the same traffic population/contract.
export async function readAccountEvidence(reader,{accountId,range,comparison,extended,now}){
 if(!reader.readAccountInsights)return null;
 const started=now;
 try{
  const [current,previous,daily,priorDaily]=await Promise.all([
   reader.readAccountInsights({...range,extended}),reader.readAccountInsights({...comparison,extended}),
   reader.readAccountInsights({...range,daily:true,extended}),reader.readAccountInsights({...comparison,daily:true,extended})
  ]);
  const normalize=(rows,r,d)=>{
   const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
   const facts=rows.map(row=>normalizeInsight(row,{level:'account',accountId,contract:CONTRACT,source:'META_INSIGHTS',observedAt:new Date(sourceReadAt(rows)??started).toISOString()}));
   if(new Set(facts.map(f=>f.since+':'+f.until)).size!==facts.length||facts.some(f=>!validDate(f.since)||!validDate(f.until)||f.entityId!==accountId||f.since<r.since||f.until>r.until||f.since>f.until||(d&&f.since!==f.until))||(!d&&(facts.length!==1||facts[0].since!==r.since||facts[0].until!==r.until)))throw Error('ACCOUNT_REPORT_IDENTITY_INVALID');
   return facts;
  };
  return {state:'AVAILABLE',current:normalize(current,range,false)[0],previous:normalize(previous,comparison,false)[0],daily:normalize(daily,range,true),priorDaily:normalize(priorDaily,comparison,true)};
 }catch(error){return {state:'UNAVAILABLE',code:/^[A-Z_0-9]+$/.test(error.code||error.message||'')?(error.code||error.message):'ACCOUNT_REPORT_UNAVAILABLE'};}
}
const close=(a,b,tolerance=1e-7)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
function population(rows,account){
 return rows.length>0&&account&&account.contract===CONTRACT&&rows.every(r=>r.contract===CONTRACT&&r.since===account.since&&r.until===account.until)&&
 ['spend','impressions','linkClicks'].every(k=>rows.every(r=>Number.isFinite(r[k]))&&close(rows.reduce((n,r)=>n+r[k],0),account[k],k==='spend'?.005:1e-7));
}
export function reconcileReportingEvents(rows,account){
 if(!population(rows,account))return rows;
 const keys=['landingPageViews','addToCart','initiateCheckout','outboundClicks'];
 const qualityKey={landingPageViews:'landing',addToCart:'cart',initiateCheckout:'checkout'};
 const zeroKeys=keys.filter(k=>rows.every(r=>r.quality?.[qualityKey[k]]!=='AMBIGUOUS')&&Number.isFinite(account[k])&&rows.some(r=>r[k]===null)&&rows.every(r=>r[k]===null||Number.isFinite(r[k])&&r[k]>=0)&&close(rows.reduce((n,r)=>n+(r[k]??0),0),account[k]));
 const purchase=Boolean(account.purchaseType)&&rows.every(r=>r.roasStatus!=='AMBIGUOUS'&&r.quality?.purchase!=='AMBIGUOUS'&&r.quality?.purchaseValue!=='AMBIGUOUS')&&rows.every(r=>!r.purchaseType||r.purchaseType===account.purchaseType)&&
 ['purchases','purchaseValue'].every(k=>Number.isFinite(account[k])&&rows.every(r=>r[k]===null||Number.isFinite(r[k])&&r[k]>=0)&&close(rows.reduce((n,r)=>n+(r[k]??0),0),account[k]))&&
 rows.every(r=>(r.purchases===null&&r.purchaseValue===null)||(Number.isFinite(r.purchases)&&Number.isFinite(r.purchaseValue)));
 if(!zeroKeys.length&&!purchase)return rows;
 return rows.map(row=>{
  const out={...row},proven=[];
  for(const k of zeroKeys)if(out[k]===null){out[k]=0;proven.push(k);}
  if(purchase&&out.purchases===null){Object.assign(out,{purchases:0,purchaseValue:0,purchaseType:account.purchaseType,roas:out.spend>0?0:null,roasStatus:out.spend>0?'ZERO':'ZERO_SPEND',cpa:null});proven.push('purchases','purchaseValue');}
  if(proven.length)out.reportingZeroProof={method:'EXHAUSTED_ACCOUNT_NONNEGATIVE_TOTAL',keys:proven,contract:CONTRACT,accountObservedAt:account.observedAt,range:{since:account.since,until:account.until}};
  return out;
 });
}
export function reportingDataset(dataset){
 const a=dataset.accountEvidence;
 if(a?.state!=='AVAILABLE')return dataset;
 const current={...dataset.current,campaign:reconcileReportingEvents(dataset.current.campaign||[],a.current)};
 const prior={...dataset.prior,campaign:reconcileReportingEvents(dataset.prior.campaign||[],a.previous)};
 const daily={...dataset.daily,campaign:(dataset.daily.campaign||[]).slice()};
 const byDay=new Map(a.daily.map(r=>[r.since,r]));
 daily.campaign=[...new Set(daily.campaign.map(r=>r.since))].sort().flatMap(day=>reconcileReportingEvents(daily.campaign.filter(r=>r.since===day),byDay.get(day)));
 return {...dataset,current,prior,daily};
}
