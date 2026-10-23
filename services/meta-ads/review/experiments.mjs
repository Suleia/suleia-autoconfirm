import {binarySamplePlan,wilson,adjustedDiscoveries} from './statistics.mjs';
const bounded=(v,n)=>{if(typeof v!=='string'||!v.trim()||v.length>n||/[\u0000-\u001f]/.test(v)||/\b(?:Bearer|sk-proj-|eyJ[A-Za-z0-9_-]{20})\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(v))throw Error('EXPERIMENT_INVALID');return v.trim();};
export function experimentDesign(input,report){
 const entity=report.rows.find(r=>r.entityId===input.entityId);if(!entity)throw Error('EXPERIMENT_ENTITY_INVALID');
 const days=Number(input.durationDays);if(!Number.isInteger(days)||days<7||days>90)throw Error('EXPERIMENT_INVALID');
 const metric=String(input.metric||'');if(!['linkCtr','cpa','roas','landingToCart','checkoutToPurchase'].includes(metric))throw Error('EXPERIMENT_INVALID');
 return {state:'DRAFT',entityId:entity.entityId,level:entity.level,name:entity.name,hypothesis:bounded(input.hypothesis,500),variable:bounded(input.variable,160),metric,durationDays:days,
  secondaryMetrics:['spend','purchases','cpa','roas'],sample:binarySamplePlan({baselineRate:input.baselineRate,minimumDetectableAbsolute:input.minimumDetectableAbsolute,independentBinary:input.independentBinary===true}),
  stopConditions:['Stop on measurement failure, unauthorized spend or delivery/checkout harm.','Do not stop early merely because an exploratory comparison looks favorable.','If the fixed horizon or planned sample is not reached, conclude INCONCLUSIVE.'],
  allocation:'Separate randomized, mutually exclusive populations; no claim that an observational before/after comparison is an experiment.',
  externalExperimentCreated:false,externalWrites:0,evidenceDigest:report.evidenceDigest,range:report.range};
}
export function experimentResult(input){
 // Results can only be labelled conclusive after the experimental assumptions
 // and fixed-horizon completion are explicitly attested. CPA/ROAS remain descriptive.
 const interval=wilson(input.successes,input.trials,{independent:input.randomized===true,binary:input.binary===true});
 const tests=Array.isArray(input.family)?input.family:[];
 if(tests.length>100||tests.some(t=>typeof t.id!=='string'||!Number.isFinite(t.p)||t.p<0||t.p>1))throw Error('EXPERIMENT_RESULT_INVALID');
 const corrected=adjustedDiscoveries(tests,{independent:false});
 return {state:'CONCLUDED',verdict:interval&&input.fixedHorizonComplete===true&&input.sampleComplete===true&&corrected.some(t=>t.discovery)?'REVIEW_REQUIRED':'INCONCLUSIVE',interval,tests:corrected,
  note:'Recorded aggregate results, not an external experiment execution or automatic winner. Correlated tests use BY; experimental design must be reviewed.',externalWrites:0};
}
export function reviewAlerts(report,history,now=Date.now()){
 const alerts=report.recommendations.filter(r=>r.priority<=2).slice(0,report.policy.maxAlerts).map(r=>{
  const key=`${report.account.id}:${r.level}:${r.entityId}:${r.code}`;
  const last=history.find(e=>e.body?.kind==='ALERT_OBSERVATION'&&e.body?.record?.key===key);
  const at=last?Date.parse(last.created_at):null;
  return {key,entityId:r.entityId,code:r.code,title:r.title,priority:r.priority,state:at!==null&&now-at<report.policy.alertCooldownMs?'COOLDOWN':'READY_FOR_INTERNAL_REVIEW',cooldownMs:report.policy.alertCooldownMs,notificationsEnabled:false,externalWrites:0};
 });
 return {alerts,notificationsEnabled:false,scheduled:false,externalWrites:0};
}
