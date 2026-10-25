import {consolidatedPolicy} from './policy.mjs';
import {madridTime} from './schedule.mjs';

// Match only provider events with an exact monetary contract to a completed own
// operation. Ambiguous, external or missing event evidence keeps the old guard.
export function ownBudgetGuardAssessment({assessment,campaign,events=[],history=[],config,now}){
  if(!consolidatedPolicy(config))return assessment;
  const id=String(campaign.id),proofs=history.filter(p=>p.mode==='LIVE'&&String(p.accountId)===String(campaign.account_id)).flatMap(p=>p.items.filter(i=>i.campaignId===id&&['VERIFIED','RECONCILED'].includes(i.result?.state)).map(i=>({key:p.id+':'+i.campaignId,before:i.before,after:i.after,start:p.createdAt,end:i.result.verifiedAt??i.result.reconciledAt})));
  const unique=new Map();
  for(const event of events.filter(e=>e.campaignId===id))unique.set(JSON.stringify([event.at,event.objectId,event.type,event.beforeCents,event.afterCents]),event);
  const rows=[...unique.values()],matched=new Set(),used=new Set();
  for(const event of rows){
    if(!event.isBudget||event.level!=='campaign'||!Number.isSafeInteger(event.beforeCents)||!Number.isSafeInteger(event.afterCents))continue;
    const at=Date.parse(event.at),matches=proofs.filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>=p.start&&p.before===event.beforeCents&&p.after===event.afterCents&&at>=Math.floor(p.start/1000)*1000&&at<=Math.ceil(p.end/1000)*1000&&!used.has(p.key));
    if(matches.length===1){used.add(matches[0].key);matched.add(event);}
  }
  const recent=rows.filter(e=>now-Date.parse(e.at)<assessment.policy.cooldownHours*3600000),today=rows.filter(e=>e.isBudget&&madridTime(Date.parse(e.at)).date===madridTime(now).date);
  const removable=new Set();
  if(recent.length&&recent.every(e=>matched.has(e)))removable.add('RECENT_SIGNIFICANT_CHANGE');
  if(today.length&&today.every(e=>matched.has(e)))for(const key of ['DAILY_CHANGE_LIMIT','CUMULATIVE_CHANGE_UNKNOWN'])removable.add(key);
  const latestBudget=rows.filter(e=>e.isBudget).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  if(latestBudget&&matched.has(latestBudget)&&Number(campaign.daily_budget)===latestBudget.afterCents)removable.add('EXTERNAL_BUDGET_NOT_RECONCILED');
  return {...assessment,reasons:assessment.reasons.filter(r=>!removable.has(r)),policy:{...assessment.policy,budgetPolicyProfile:config.approved.policyProfile},ownGuardExemptions:[...removable].filter(r=>assessment.reasons.includes(r))};
}

// V6 uses today's independent performance sample. Weekly performance and age
// remain diagnostic context, never an automatic veto. Operational evidence is
// checked separately so an incomplete combined assessment is not waived.
export function v6BudgetGuards(assessment,sources){
 const context=new Set(['CAMPAIGN_AGE_UNKNOWN_OR_YOUNG','INSUFFICIENT_MULTIDAY_SAMPLE','ROAS_MISSING_OR_AMBIGUOUS','VOLATILITY_OR_INCOMPLETE_HISTORY','VERIFIED_ECONOMICS_MISSING']);
 const operational=['account','entities_campaign','entities_adset','activities','currentActivities','rules'];
 const complete=operational.every(k=>sources?.[k]?.status==='COMPLETE');
 const reasons=assessment.reasons.filter(r=>!context.has(r)&&!(r==='INCOMPLETE_EVIDENCE'&&complete));
 if(!complete)reasons.push('INCOMPLETE_OPERATIONAL_EVIDENCE');
 return {...assessment,reasons:[...new Set(reasons)],sourceDiagnostics:Object.fromEntries([...operational,'daily_campaign'].map(k=>[k,sources?.[k]||{status:'UNAVAILABLE',code:'SOURCE_NOT_CAPTURED'}])),contextWarnings:assessment.reasons.filter(r=>context.has(r)),policy:{...assessment.policy,budgetPolicyProfile:'V6_FIXED_EUR'}};
}
