import {campaignAudit} from './campaign-audit.mjs';
import {analyzeReview} from './analyze.mjs';
import {reviewWindow,comparisonWindow} from './periods.mjs';
import {REVIEW_POLICY,AUDIT_PROFILES} from './policy.mjs';
import {parseReviewQuestion,formatReview} from './queries.mjs';
import {experimentDesign,experimentResult,reviewAlerts} from './experiments.mjs';

// Uses the runtime's canonical snapshot/cache and its one existing Meta reader.
// This module receives no budget writer, scheduler or messaging transport.
export function createReviewService({snapshot,extras,ledger,productMappings=[],readCommerce=null,maxCampaigns=5,panelUrl=null,budgetPolicy=null,optionalWaitMs=7000,now=()=>Date.now()}){
 if(!Number.isInteger(maxCampaigns)||maxCampaigns<2||maxCampaigns>10)throw Error('REVIEW_CONFIGURATION_INVALID');
 if(panelUrl){try{const u=new URL(panelUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();panelUrl=u.href;}catch{throw Error('REVIEW_PANEL_URL_INVALID');}}
 const policy={...REVIEW_POLICY,maxCampaigns};
 const ensure=()=>{if(!snapshot||!extras)throw Error('ADS_REVIEW_DISABLED');};
 async function report(query={}){
  ensure();const range=reviewWindow(query,now()),comparison=comparisonWindow(range,query,now());
  const base=await snapshot({...range,force:query.force===true||query.force==='true'},90);
  let baseline=null;
  if(comparison.since!==base.dataset.comparison.since||comparison.until!==base.dataset.comparison.until){const b=await snapshot(comparison,90);baseline={...b.dataset,readFailed:b.readFailed};}
  let data={...base.dataset,readFailed:base.readFailed||baseline?.readFailed};
  if(query.selector){
   const s=String(query.selector).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s/g,'');
   const matches=data.entities.campaign.filter(c=>String(c.id)===s||String(c.name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s/g,'').includes(s));
   if(matches.length!==1)return {clarification:'Indica un único ID de campaña: el nombre coincide con varias campañas o ninguna.'};
   query={...query,campaignId:String(matches[0].id)};
  }
  let timer;const tasks=Promise.allSettled([extras(range,query),readCommerce?readCommerce(range):Promise.resolve(null)]);
  let results;try{results=await Promise.race([tasks,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),optionalWaitMs);})]);}finally{clearTimeout(timer);}
  const evidence=results?.[0]?.status==='fulfilled'?results[0].value:{unavailable:[results?'META_OPTIONAL_EVIDENCE_UNAVAILABLE':'META_OPTIONAL_EVIDENCE_PREPARING']};
  if(results?.[1]?.status==='rejected')evidence.unavailable=[...(evidence.unavailable||[]),'COMMERCE_UNAVAILABLE'];
  const options={dataset:data,baseline,query,extras:evidence,commerce:results?.[1]?.status==='fulfilled'?results[1].value:null,productMappings,policy,now:now()};
  const value=analyzeReview(options);value.diagnostic=base.diagnostic;
  if(value.level==='campaign'&&value.rows.length===1&&(query.audit==='true'||query.audit===true||query.selector||query.campaignId||String(query.campaignIds||'').split(',').filter(Boolean).length===1)){
   const id=value.rows[0].entityId,ads=analyzeReview({...options,query:{...query,level:'ad',campaignId:id}});
   let history={entries:[],nextCursor:null,status:'UNAVAILABLE'};
   if(ledger?.autopilotAudit)try{history={...await ledger.autopilotAudit(String(value.account.id).replace(/^act_/,''),{campaignId:id,limit:25}),status:'AVAILABLE'};}catch{}
   value.campaignAudit=campaignAudit({report:value,ads,history});value.campaignAudit.budgetControls={policy:budgetPolicy,state:"NOT_AUTHORIZED_BY_REVIEW",note:"El periodo histórico seleccionado no acredita los requisitos intradiarios de V5.1. Consultar Presupuestos para la decisión actual del ejecutor, sin omitir aprendizaje, muestra, cambios externos ni verificaciones."};
  }
  return value;

 }
 async function history({cursor=null,limit=25}={}){return ledger.reviewHistory({cursor,limit});}
 async function alertsFor(value){const candidates=reviewAlerts(value,[],now());const history=(await Promise.all(candidates.alerts.map(a=>ledger.latestReviewAlert(a.key)))).filter(Boolean);return reviewAlerts(value,history,now());}
 return {policy,report,history,parse:parseReviewQuestion,profiles:AUDIT_PROFILES,
  async answer(text,query={}){const intent=parseReviewQuestion(text);if(!intent)throw Error('REVIEW_QUESTION_INVALID');const value=await report({...intent,...query});if(value.clarification)return {text:value.clarification,externalWrites:0};return {review:value,text:formatReview(value,intent),deepLink:panelUrl?`${panelUrl}#ads?review=v7&campaignId=${encodeURIComponent(value.campaignAudit?.campaignId||query.campaignId||'')}&period=${encodeURIComponent(intent.period)}&tab=${intent.focus==='comparison'?'comparator':'diagnosis'}`:null,externalWrites:0};},
  async record({kind,reference='ACCOUNT',query={},input={},principal,expectedDigest=null}){
   if(!['REVIEW','DECISION','EXPERIMENT','EXPERIMENT_RESULT','ALERT_OBSERVATION'].includes(kind)||typeof principal!=='string'||!principal||principal.length>160||typeof reference!=='string'||reference.length>160||(kind==='REVIEW'&&reference!=='ACCOUNT'))throw Error('QUERY_INVALID');
   const value=await report(query);if(value.clarification||value.freshness!=='FRESH')throw Error('REVIEW_EVIDENCE_UNAVAILABLE');
   if(expectedDigest!==null&&expectedDigest!==value.evidenceDigest)throw Error('REVIEW_EVIDENCE_CHANGED');
   let record;
   if(kind==='EXPERIMENT')record=experimentDesign(input,value);
   else if(kind==='EXPERIMENT_RESULT'){
    const previous=await ledger.reviewById(reference);
    if(!previous||previous.body.kind!=='EXPERIMENT')throw Error('EXPERIMENT_REFERENCE_INVALID');
    record={...experimentResult(input),experimentId:reference};
   }else if(kind==='DECISION'){
    const recommendation=value.recommendations.find(r=>r.id===reference);
    if(!recommendation||!['APPROVED_FOR_REVIEW','DISMISSED','OBSERVE','FALSE_POSITIVE'].includes(input.verdict))throw Error('REVIEW_DECISION_INVALID');
    record={verdict:input.verdict,recommendation,execution:'REVIEW_ONLY'};
   }else if(kind==='ALERT_OBSERVATION'){
    const alerts=await alertsFor(value);
    record=alerts.alerts.find(a=>a.key===reference&&a.state==='READY_FOR_INTERNAL_REVIEW');if(!record)throw Error('ALERT_COOLDOWN_OR_MISSING');
   }else record={summary:value.summary,range:value.range,baselineRange:value.baselineRange,level:value.level,selection:value.selection,recommendations:value.recommendations.map(r=>r.id)};
   return ledger.appendReviewRecord({kind,reference,record,principal,evidenceDigest:value.evidenceDigest,observedAt:value.observedAt});
  },
  async alerts(query={}){const value=await report(query);if(value.clarification)return value;return alertsFor(value);},
  async audit(profile){const p=AUDIT_PROFILES.find(p=>p.id===profile);if(!p)throw Error('QUERY_INVALID');return {profile:p,report:await report({period:p.period})};}
 };
}
