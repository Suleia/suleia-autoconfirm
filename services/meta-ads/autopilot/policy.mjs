import {NIGHT_TIMES,isNight,madridTime,instantFor} from './schedule.mjs';
import {V6_POLICY,V6_PROFILE,isV6,evaluateV6} from './v6-policy.mjs';

export const AUTOPILOT_VERSION='meta-budget-autopilot-v5.1';
export const AUTOPILOT_LIVE_COMPILED=true; // Owner-approved V5.1 release; complete runtime policy and first-write verification remain mandatory.
export const AUTOPILOT_POLICY=Object.freeze({version:AUTOPILOT_VERSION,roasThreshold:3.8,increaseCents:1000,decreaseCents:1000,maxBudgetCents:7000,minPurchases:3,maxAgeMs:120000,nightHighCents:2500,nightLowCents:2000});
const positive=v=>Number.isFinite(v)&&v>0;
export const consolidatedPolicy=config=>config?.approved?.policyProfile==='V5_1_FIXED_EUR'||isV6(config);
export function autopilotMetric(metric) {
  if(!metric||!Object.hasOwn(metric,'metaPurchases'))return metric;
  const valid=['VALID','ZERO'].includes(metric.metaPurchaseStatus)&&['VALID','ZERO'].includes(metric.metaPurchaseValueStatus);
  const status=valid?metric.metaRoasStatus:[metric.metaPurchaseStatus,metric.metaPurchaseValueStatus].includes('AMBIGUOUS')?'AMBIGUOUS':'MISSING';
  return {...metric,canonicalPurchases:metric.purchases,canonicalPurchaseType:metric.purchaseType,purchases:metric.metaPurchases,purchaseValue:metric.metaPurchaseValue,purchaseType:metric.metaRoasPurchaseType,roas:valid?metric.metaRoas:null,roasStatus:status,metaRoasStatus:status};
}
export function loadAutopilotConfig(env={},legacy={}, {liveCompiled=AUTOPILOT_LIVE_COMPILED}={}) {
  const enabled=env.AUTOPILOT_ENABLED==='true',mode=env.AUTOPILOT_MODE||'SHADOW';
  if(!['SHADOW','SIMULATION'].includes(mode)&&!(mode==='LIVE'&&liveCompiled===true&&env.AUTOPILOT_LIVE_AUTHORIZED==='true'))throw Error('AUTOPILOT_LIVE_NOT_AUTHORIZED');
  if(enabled&&mode!=='LIVE'&&(['META_WRITES_ENABLED','ADS_INTELLIGENCE_WRITES_ENABLED'].some(k=>env[k]!==undefined&&env[k]!=='false')||env.ADS_INTELLIGENCE_MODE==='LIVE'))throw Error('AUTOPILOT_REQUIRES_WRITES_DISABLED');
  if(enabled&&mode==='LIVE'&&(!liveCompiled||env.ADS_INTELLIGENCE_MODE!=='LIVE'||env.ADS_INTELLIGENCE_WRITES_ENABLED!=='true'||env.META_WRITES_ENABLED!=='false'))throw Error('AUTOPILOT_LIVE_NOT_AUTHORIZED');
  const approved=env.AUTOPILOT_APPROVED_POLICY_JSON?JSON.parse(env.AUTOPILOT_APPROVED_POLICY_JSON):{};
  const v6=isV6({approved}),policy=v6?V6_POLICY:AUTOPILOT_POLICY;
  const fixed={ROAS_THRESHOLD:3.8,BUDGET_INCREASE_EUR:10,BUDGET_DECREASE_EUR:10,MAX_DAY_BUDGET_EUR:v6?100:70,MIN_PURCHASES_TO_INCREASE:3};
  if(Object.entries(fixed).some(([k,v])=>env[k]!==undefined&&Number(env[k])!==v))throw Error('AUTOPILOT_POLICY_VERSION_REQUIRED');
  if(Object.keys(approved).length&&!/^[\w:./-]{3,160}$/.test(approved.approvalReference||''))throw Error('AUTOPILOT_POLICY_APPROVAL_REFERENCE_REQUIRED');
  const allowed=new Set(['approvalReference','minimumBudgetCents','globalExposureCents','globalSpendLimitCents','globalSpendLimitMode','policyProfile','roasReductionMode','incrementalPurchases','reductionMinSpend','reductionMinImpressions','attributionMaturityMinutes','aggregateIncreaseCents','authorizationExpiresAt']);
  if(Object.keys(approved).some(k=>!allowed.has(k)))throw Error('AUTOPILOT_POLICY_INVALID');
  const text=new Set(['approvalReference','globalSpendLimitMode','policyProfile','roasReductionMode','authorizationExpiresAt']);
  for(const[k,v]of Object.entries(approved))if(!text.has(k)&&(!positive(v)||!Number.isSafeInteger(v)))throw Error('AUTOPILOT_POLICY_INVALID');
  if(approved.globalSpendLimitMode!==undefined&&!['CAPPED','UNLIMITED_AUTHORIZED'].includes(approved.globalSpendLimitMode))throw Error('AUTOPILOT_POLICY_INVALID');
  if(approved.globalSpendLimitMode==='UNLIMITED_AUTHORIZED'&&approved.globalSpendLimitCents!==undefined)throw Error('AUTOPILOT_POLICY_INVALID');
  if(approved.policyProfile!==undefined&&!['LEGACY_BOUNDED','V5_1_FIXED_EUR',V6_PROFILE].includes(approved.policyProfile))throw Error('AUTOPILOT_POLICY_INVALID');
  if(approved.authorizationExpiresAt&&(!Number.isFinite(Date.parse(approved.authorizationExpiresAt))||Date.parse(approved.authorizationExpiresAt)<=Date.now()))throw Error('AUTOPILOT_AUTHORIZATION_EXPIRED');
  if(v6&&(approved.minimumBudgetCents!==1500||approved.globalExposureCents!==100000||approved.incrementalPurchases!==3||!Number.isSafeInteger(approved.aggregateIncreaseCents)||approved.aggregateIncreaseCents<=0||approved.aggregateIncreaseCents>100000||Math.round(Number(env.ADS_MAX_AGGREGATE_INCREASE_EUR)*100)!==approved.aggregateIncreaseCents))throw Error('V6_MONETARY_POLICY_INCOMPLETE');
  if(approved.roasReductionMode!==undefined&&!['ENABLED','BLOCKED'].includes(approved.roasReductionMode))throw Error('AUTOPILOT_POLICY_INVALID');
  const verifiedMinimums=JSON.parse(env.AUTOPILOT_VERIFIED_MINIMUMS_JSON||'[]');
  if(!Array.isArray(verifiedMinimums)||new Set(verifiedMinimums.map(r=>r.campaignId)).size!==verifiedMinimums.length||verifiedMinimums.some(r=>!/^\d+$/.test(r.campaignId)||!/^\d+$/.test(r.accountId)||r.currency!=='EUR'||!Number.isSafeInteger(r.minimumCents)||r.minimumCents<=0||!Number.isFinite(Date.parse(r.verifiedAt))||!Number.isFinite(Date.parse(r.validUntil))||Date.parse(r.validUntil)<=Date.parse(r.verifiedAt)||!/^[\w:./-]{3,160}$/.test(r.reference||'')))throw Error('AUTOPILOT_VERIFIED_MINIMUMS_INVALID');
  if(mode==='LIVE'&&(!enabled||!['V5_1_FIXED_EUR',V6_PROFILE].includes(approved.policyProfile)||!approved.minimumBudgetCents||approved.minimumBudgetCents>2000||!approved.globalExposureCents||!approved.incrementalPurchases||!(approved.globalSpendLimitMode==='UNLIMITED_AUTHORIZED'||approved.globalSpendLimitMode==='CAPPED'&&approved.globalSpendLimitCents)||!['ENABLED','BLOCKED'].includes(approved.roasReductionMode)||(approved.roasReductionMode==='ENABLED'&&![approved.reductionMinSpend,approved.reductionMinImpressions,approved.attributionMaturityMinutes].every(positive))||verifiedMinimums.length===0))throw Error('AUTOPILOT_LIVE_POLICY_INCOMPLETE');
  return {enabled,mode,policy,approved,verifiedMinimums,legacy,liveCompiled,writesEnabled:mode==='LIVE'&&liveCompiled};
}
export function nightTarget(metric,policy=AUTOPILOT_POLICY) {
  const known=['VALID','ZERO'].includes(metric?.metaRoasStatus)&&Number.isFinite(metric?.metaRoas)&&metric?.spend>0&&Number.isSafeInteger(metric?.purchases)&&metric.purchases>=0&&metric.metaRoasPurchaseType===metric.purchaseType&&Boolean(metric.purchaseType);
  return {cents:known&&metric.metaRoas>=policy.roasThreshold?policy.nightHighCents:policy.nightLowCents,
    reason:known?'NIGHT_ROAS_CAP':'NIGHT_UNKNOWN_ROAS_CONSERVATIVE_CAP'};
}
export function campaignHistory(history,campaignId) {
  return history.flatMap(p=>p.items.filter(i=>i.campaignId===campaignId).map(i=>({proposal:p,item:i}))).sort((a,b)=>a.proposal.createdAt-b.proposal.createdAt);
}
export function spendLimitReasons(config,accountSpend,now) {
  const unlimited=config.approved.globalSpendLimitMode==='UNLIMITED_AUTHORIZED';
  if(!config.approved.globalSpendLimitCents&&!unlimited)return ['GLOBAL_SPEND_LIMIT_NOT_APPROVED'];
  if(accountSpend?.complete!==true||!Number.isSafeInteger(accountSpend.spendCents)||accountSpend.spendCents<0||accountSpend.date!==madridTime(now).date||!Number.isFinite(Date.parse(accountSpend.observedAt))||now-Date.parse(accountSpend.observedAt)>config.policy.maxAgeMs||now-Date.parse(accountSpend.observedAt)<-5000)return ['ACCOUNT_SPEND_UNVERIFIED'];
  return !unlimited&&accountSpend.spendCents>=config.approved.globalSpendLimitCents?['ACCOUNT_SPEND_LIMIT_REACHED']:[];
}
export function evaluateAutopilot({campaign,metric,slot,now,config,history=[],constraints=null,accountSpend=null,...extra}) {
  if(isV6(config))return evaluateV6({campaign,metric,slot,now,config,history,constraints,accountSpend,...extra});
  const p=config.policy,before=Number(campaign.daily_budget),reasons=[],warnings=[],local=madridTime(now);
  const applicableMinimum=constraints?.perCampaign?constraints.perCampaign[String(campaign.id)]:constraints;
  const h=campaignHistory(history,String(campaign.id));
  const applied=h.filter(({item})=>['VERIFIED','RECONCILED','EXECUTING','UNKNOWN'].includes(item.result?.state));
  const shadow=h.filter(({proposal,item})=>proposal.mode===config.mode&&item.result?.state==='SIMULATED'&&madridTime(proposal.createdAt).date===local.date);
  const used=[...applied,...shadow].sort((a,b)=>a.proposal.createdAt-b.proposal.createdAt);
  const today=used.filter(({proposal})=>madridTime(proposal.createdAt).date===local.date);
  const lastIncrease=today.filter(({item})=>item.after>item.before).at(-1);
  const metaKnown=['VALID','ZERO'].includes(metric?.metaRoasStatus)&&Number.isFinite(metric?.metaRoas);
  const fresh=metric?.complete===true&&metric?.since===local.date&&metric?.until===local.date&&Number.isFinite(Date.parse(metric.observedAt))&&now-Date.parse(metric.observedAt)>=-5000&&now-Date.parse(metric.observedAt)<=p.maxAgeMs;
  if(!Number.isSafeInteger(before)||before<=0||Number(campaign.lifetime_budget)>0)reasons.push('CAMPAIGN_DAILY_BUDGET_REQUIRED');
  if(campaign.status!=='ACTIVE'||campaign.effective_status!=='ACTIVE')reasons.push('CAMPAIGN_INACTIVE');
  let after=before,action='HOLD',rule='HOLD',target=null;
  if(slot.date!==local.date){rule='FUTURE_DAY_METRICS_REQUIRED';reasons.push('FUTURE_DAY_METRICS_REQUIRED');}
  else if(slot.kind==='NIGHT') {
    target=nightTarget(fresh?metric:null,p);rule=target.reason;
    if(before>target.cents){after=before-Math.ceil((before-target.cents)/(NIGHT_TIMES.length-slot.nightIndex));action='NIGHT_DECREASE';}
    if(!metaKnown||!fresh)warnings.push('NIGHT_UNKNOWN_ROAS_CONSERVATIVE_CAP');
  } else if(!fresh)reasons.push('AUTOPILOT_STALE_OR_WRONG_DAY');
  else if(!metaKnown)reasons.push(metric?.metaRoasStatus==='AMBIGUOUS'?'ROAS_AMBIGUOUS':'ROAS_MISSING');
  else if(metric.metaRoas>p.roasThreshold) {
    rule='ROAS_ABOVE_THRESHOLD';
    if(before<p.maxBudgetCents){after=Math.min(before+p.increaseCents,p.maxBudgetCents);action='INCREASE';}
    else reasons.push('MAX_BUDGET');
  } else if(metric.metaRoas<p.roasThreshold&&slot.kind==='SPECIAL') {
    rule='SPECIAL_ROAS_BELOW_THRESHOLD';action='DECREASE';
    after=Math.min(before,Math.max(before-p.decreaseCents,config.approved.minimumBudgetCents||0));
    if(after===before){action='HOLD';rule='OPERATING_MINIMUM_REACHED';}
  } else rule=metric.metaRoas===p.roasThreshold?'ROAS_EQUAL_THRESHOLD':'ORDINARY_HOLD';
  if(action==='INCREASE') {
    if(!Number.isSafeInteger(metric.purchases)||metric.purchases<p.minPurchases)reasons.push('MIN_THREE_PURCHASES');
    if(!(metric.spend>0))reasons.push('ROAS_ZERO_SPEND');
    if(metric.metaRoasPurchaseType!==metric.purchaseType)reasons.push('ROAS_SCOPE_MISMATCH');
    if(lastIncrease){
      if(lastIncrease.item.metric?.purchaseType!==metric.purchaseType||lastIncrease.item.metric?.contract!==metric.contract)reasons.push('INCREMENTAL_SCOPE_CHANGED');
      if(!config.approved.incrementalPurchases)reasons.push('INCREMENTAL_POLICY_NOT_APPROVED');
      else if(metric.purchases-(lastIncrease.item.metric?.purchases??Infinity)<config.approved.incrementalPurchases)reasons.push('CONVERSIONS_ALREADY_USED');
      if(metric.purchaseValue<(lastIncrease.item.metric?.purchaseValue??0)||metric.spend<(lastIncrease.item.metric?.spend??0))reasons.push('ATTRIBUTION_REVISION');
    }
    if(!config.approved.globalExposureCents)reasons.push('GLOBAL_EXPOSURE_POLICY_NOT_APPROVED');
    reasons.push(...spendLimitReasons(config,accountSpend,now));
    if(!consolidatedPolicy(config)&&positive(config.legacy.minPurchases)&&metric.purchases<config.legacy.minPurchases)reasons.push('LEGACY_SAMPLE_MINIMUM');
    if(!positive(config.legacy.minSpend)||!positive(config.legacy.minImpressions))reasons.push('SAMPLE_POLICY_NOT_CONFIGURED');
    else if(metric.spend<config.legacy.minSpend||metric.impressions<config.legacy.minImpressions)reasons.push('INSUFFICIENT_SAMPLE');
  }
  if(action==='DECREASE') {
    const approved=config.approved;
    if(approved.roasReductionMode==='BLOCKED')reasons.push('ROAS_REDUCTIONS_NOT_AUTHORIZED');
    if(!approved.reductionMinSpend||!approved.reductionMinImpressions||!approved.attributionMaturityMinutes)reasons.push('REDUCTION_SAMPLE_POLICY_NOT_APPROVED');
    else {
      const since=consolidatedPolicy(config)?Math.max(instantFor(local.date,'00:00'),...used.filter(({item})=>['VERIFIED','RECONCILED','SIMULATED'].includes(item.result?.state)).map(({proposal,item})=>Number.isFinite(item.result?.verifiedAt)?item.result.verifiedAt:proposal.createdAt)):instantFor(local.date,'00:00');
      if(!(metric.spend>=approved.reductionMinSpend&&metric.impressions>=approved.reductionMinImpressions)||now-since<approved.attributionMaturityMinutes*60000)reasons.push('REDUCTION_SAMPLE_INSUFFICIENT');
    }
    if(metric.metaRoasPurchaseType!==metric.purchaseType)reasons.push('ROAS_SCOPE_MISMATCH');
  }
  if(action!=='HOLD') {
    if(!config.approved.minimumBudgetCents)reasons.push('OPERATING_MINIMUM_NOT_APPROVED');
    if(!applicableMinimum?.verified||!Number.isSafeInteger(applicableMinimum.minimumCents)||applicableMinimum.minimumCents<=0)reasons.push('META_MINIMUM_NOT_VERIFIED');
    else if(after<applicableMinimum.minimumCents)reasons.push('META_MINIMUM_CONFLICT');
    if(config.approved.minimumBudgetCents&&after<config.approved.minimumBudgetCents)reasons.push('MIN_BUDGET');
    if(!Number.isSafeInteger(after)||after<=0||after===before)reasons.push('BUDGET_INVALID_OR_UNCHANGED');
    if(after>p.maxBudgetCents)reasons.push('MAX_BUDGET');
    const manual=used.filter(({proposal})=>proposal.origin!=='AUTOPILOT').at(-1);
    if(slot.kind!=='NIGHT'&&manual&&madridTime(manual.proposal.createdAt).date===local.date)reasons.push('MANUAL_HOLD_UNTIL_NIGHT');
    if(!consolidatedPolicy(config)&&used.some(({proposal})=>now-proposal.createdAt<(config.legacy.campaignCooldownMs||86400000)))reasons.push('CAMPAIGN_COOLDOWN');
    const change=Math.abs(after-before)*100;
    if(!consolidatedPolicy(config)&&(!positive(config.legacy.maxChangePercent)||change>before*config.legacy.maxChangePercent))reasons.push('MAX_CHANGE_PERCENT');
  }
  return {campaignId:String(campaign.id),name:campaign.name,before,after,action,rule,reasons:[...new Set(reasons)],warnings,metric:metric||null,nightTargetCents:target?.cents??nightTarget(fresh?metric:null,p).cents,
    state:reasons.length?'BLOCKED':action==='HOLD'?'HOLD':'VALIDATED',changesToday:today.length,incrementsToday:today.filter(x=>x.item.after>x.item.before).length,
    verifiedChangesToday:today.filter(x=>x.item.result?.state==='VERIFIED').length,shadowChangesToday:shadow.length,
    lastChangeAt:applied.filter(x=>x.item.result?.state==='VERIFIED').at(-1)?.proposal.createdAt??null,
    manualHoldUntil:local.time<'22:30'&&used.some(x=>x.proposal.origin!=='AUTOPILOT'&&madridTime(x.proposal.createdAt).date===local.date)?`${local.date} 22:30 Europe/Madrid`:null};
}
export function manualAutopilotReasons({before,after,metric,now,config,inventory}) {
  const reasons=[];
  if(after>config.policy.maxBudgetCents)reasons.push('MAX_BUDGET');
  if(!config.approved.minimumBudgetCents)reasons.push('OPERATING_MINIMUM_NOT_APPROVED');
  else if(after<config.approved.minimumBudgetCents)reasons.push('MIN_BUDGET');
  if(after>before){
    reasons.push(...spendLimitReasons(config,inventory?.accountSpend,now));
    if(!config.approved.globalExposureCents)reasons.push('GLOBAL_EXPOSURE_POLICY_NOT_APPROVED');
    else if(inventory){const active=inventory.campaigns.filter(c=>c.effective_status==='ACTIVE');if(active.some(c=>!Number.isSafeInteger(Number(c.daily_budget))||Number(c.daily_budget)<=0))reasons.push('GLOBAL_EXPOSURE_UNVERIFIED');else if(active.reduce((s,c)=>s+Number(c.daily_budget),0)+after-before>config.approved.globalExposureCents)reasons.push('GLOBAL_EXPOSURE_LIMIT');}
  }
  if(isNight(now,config.policy.version)) {
    if(after>before)reasons.push('NIGHT_INCREASE_BLOCKED');
    if(!isV6(config)&&after>nightTarget(metric,config.policy).cents)reasons.push('NIGHT_CAP');
  }
  return reasons;
}
