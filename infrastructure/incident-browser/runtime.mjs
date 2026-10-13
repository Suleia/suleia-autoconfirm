import fs from 'node:fs/promises';
import {loadProviderEnv,observeRetryCandidates} from './worker.mjs';
import {retryEvidencePlan,executeEvidenceRetry} from './retry-policy.mjs';
import {captureRetryEvidence} from './capture.mjs';
import {prepareRetry,readEvidenceDetail} from './dropea-ui.mjs';
import {executionFailure} from './runtime-state.mjs';

export function verifiedProviderRetry(raw,plan,attemptedAt){
 return String(raw?.id)===plan.issueId&&String(raw?.order_id)===plan.orderId&&raw.status==='RESOLVED'&&raw.resolution_status==='RETRY'
  &&raw.resolution_data?.date===plan.date&&raw.resolution_data?.time_window===plan.time_window
  &&Number.isFinite(Date.parse(raw.resolution_changed_at))&&Date.parse(raw.resolution_changed_at)>=Date.parse(attemptedAt)-1000;
}
const claimArgs=plan=>({storeId:'suleia',orderId:plan.orderId,templateName:`incident_resolution_v1:${plan.issueId}`,provider:'dropea'});
async function verifySavedRetry(context,p,attemptedAt){
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 let raw;
 for(let n=0;n<3;n++){
  const current=await readDropeaV2ReturnIssueState({orderId:p.orderId,incidenceId:p.issueId});raw=current.issue?.raw||current.issue;
  if(verifiedProviderRetry(raw,p,attemptedAt))break;
  await new Promise(r=>setTimeout(r,1500));
 }
 if(!verifiedProviderRetry(raw,p,attemptedAt))return false;
 const {page,dialog,text}=await readEvidenceDetail(context,p);
 if(!text.includes('ES'+p.orderId))return false;
 const label={morning:'Mañana',afternoon:'Tarde'}[p.time_window];
 const history=dialog.locator('.history-item').filter({hasText:'Reintentar entrega'}).filter({hasText:p.date}).filter({hasText:label});
 if(await history.count()!==1||await history.locator('button[aria-label="Ver evidencia"]').count()!==1)return false;
 await page.screenshot({path:`/evidence/verified-${p.orderId}-${p.issueId}.png`,timeout:15000});
 return true;
}
async function reconcileInterruptedRetry(context){
 let pending;try{pending=JSON.parse(await fs.readFile('/state/retry-inflight.json','utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
 const {plan,attemptedAt}=pending;
 const marker={at:new Date().toISOString(),orderId:plan.orderId,issueId:plan.issueId,saveAttempted:true,status:'RECONCILE',reason:'INTERRUPTED_SAVE'};
 // Reconciliation only reads providers. It must never click Save again.
 await fs.writeFile('/state/retry-reconcile.json',JSON.stringify(marker),{mode:0o600});
 if(!await verifySavedRetry(context,plan,attemptedAt).catch(()=>false))return;
 const {finishTemplateDelivery}=await import('../../autoconfirm/src/db/supabase-store.mjs');
 await finishTemplateDelivery({...claimArgs(plan),status:'verified',attemptedAt,sentAt:new Date().toISOString(),raw:{owner:'vps_retry_evidence',orderId:plan.orderId,issueId:plan.issueId,date:plan.date,time_window:plan.time_window,scheduleSource:plan.scheduleSource,reason:'VERIFIED_AFTER_INTERRUPTED_SAVE'}});
 await fs.appendFile('/state/retry-audit.jsonl',JSON.stringify({...marker,status:'VERIFIED',reason:'RECONCILED_WITHOUT_RESEND'})+'\n',{mode:0o600});
 await fs.unlink('/state/retry-inflight.json');await fs.unlink('/state/retry-reconcile.json');
 const control=JSON.parse(await fs.readFile('/state/retry-control.json','utf8'));
 if(control.mode==='AUTO_CANARY')await fs.writeFile('/state/retry-control.json',JSON.stringify({...control,mode:'AUTO',promotedAt:new Date().toISOString(),verifiedOrderId:plan.orderId}),{mode:0o600});
}
export async function runVpsRetryCycle(context){
 await loadProviderEnv();
 await reconcileInterruptedRetry(context);
 const observation=await observeRetryCandidates();
 let control={mode:'OBSERVE_ONLY'};
 try{control=JSON.parse(await fs.readFile('/state/retry-control.json','utf8'));}catch{}
 if(!['AUTO_CANARY','AUTO'].includes(control.mode))return {...observation,executionEnabled:false};
 try{await fs.access('/state/retry-reconcile.json');return {...observation,executionEnabled:false,error:'RECONCILIATION_REQUIRED'};}catch{}
 const {selectRows}=await import('../../autoconfirm/src/clients/supabase.mjs');
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 const {getIncidentChatMessages,loadSubscriberIndex,findSubscriberInIndexForExactOrder}=await import('../../autoconfirm/src/clients/chatby.mjs');
 const {inspectPriorOrderReturn}=await import('../../autoconfirm/src/workflows/incident-order-return-guard.mjs');
 const {claimTemplateDelivery,finishTemplateDelivery}=await import('../../autoconfirm/src/db/supabase-store.mjs');
 const report=JSON.parse(await fs.readFile('/state/retry-observation.json','utf8'));
 const candidates=report.cases.filter(c=>c.eligible&&
  (control.mode!=='AUTO_CANARY'||!control.canaryOrderId||String(c.orderId)===String(control.canaryOrderId))).slice(0,1);
 const results=[];
 for(const candidate of candidates){
  let plan=candidate.plan,attemptedAt=new Date().toISOString(),saveAttempted=false;
  async function revalidate(){
   const cached=(await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value'},limit:1}))[0];
   const incident=cached?.value?.incidents?.find(i=>String(i.orderId)===plan.orderId&&String(i.incidenceId)===plan.issueId);
   if(!incident)return {eligible:false,reason:'CURRENT_INCIDENT_REQUIRED'};
   const current=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});
   const index=await loadSubscriberIndex({maxPages:30,force:true});
   const subscriber=findSubscriberInIndexForExactOrder(index,{phone:current.order.customerPhone,orderId:plan.orderId});
   if(!subscriber||subscriber.user_ns!==plan.conversationId)return {eligible:false,reason:'FRESH_ASSOCIATION_REQUIRED'};
   const prior=await inspectPriorOrderReturn(incident);
   if(prior.verified||prior.blocked)return {eligible:false,reason:'PRIOR_RETURN_GUARD'};
   const messages=await getIncidentChatMessages(plan.conversationId);
   return retryEvidencePlan({incident:{...incident,chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},...current,messages});
  }
  try{
   let result=await executeEvidenceRetry(plan,{
    revalidate,capture:p=>captureRetryEvidence(context,p),claim:p=>claimTemplateDelivery(claimArgs(p)),
    finish:async(status,p)=>{
     const result=await finishTemplateDelivery({...claimArgs(p),status,attemptedAt,sentAt:status==='verified'?new Date().toISOString():null,
      raw:{owner:'vps_retry_evidence',reason:'EXACT_ORDER_FUTURE_RETRY_WITH_SCREENSHOT',scheduleSource:p.scheduleSource,orderId:p.orderId,issueId:p.issueId,date:p.date,time_window:p.time_window,at:new Date().toISOString(),status}});
     if(result?.skipped)throw Error('PERSISTENT_LEDGER_REQUIRED');
    },
    write:async(p,proof)=>{
     const draft=await prepareRetry(context,p,proof);
     const latest=await revalidate();
     if(!latest.eligible||latest.hash!==p.hash){await draft.cancel();throw Error('LATE_REPLY');}
     attemptedAt=new Date().toISOString();
     await fs.writeFile('/state/retry-inflight.tmp',JSON.stringify({plan,attemptedAt,proof:proof.sha256}),{mode:0o600});
     await fs.rename('/state/retry-inflight.tmp','/state/retry-inflight.json');
     await fs.appendFile('/state/retry-audit.jsonl',JSON.stringify({at:attemptedAt,orderId:p.orderId,issueId:p.issueId,reason:'EXACT_ORDER_FUTURE_RETRY_WITH_SCREENSHOT',result:'ATTEMPTING',proof:proof.sha256})+'\n',{mode:0o600});
     saveAttempted=true;await draft.save();
    },
    verify:async p=>{
     if(!saveAttempted)return false;
     return verifySavedRetry(context,p,attemptedAt);
    }
   });
   if(result.status==='RECONCILE'&&!saveAttempted&&result.reason!=='EXISTING_OR_UNAVAILABLE_CLAIM'){
    // A failed preparation cannot have mutated Dropea. Keep the case claim for
    // review, but do not stop unrelated incidents as if Save were uncertain.
    result={status:'FAILED_PRE_SAVE',reason:'PREPARATION_FAILED_CLAIM_RETAINED'};
   }
   results.push({orderId:plan.orderId,issueId:plan.issueId,saveAttempted,...result});
   await fs.appendFile('/state/retry-audit.jsonl',JSON.stringify({at:new Date().toISOString(),orderId:plan.orderId,issueId:plan.issueId,...result})+'\n',{mode:0o600});
   if(result.status==='RECONCILE'&&saveAttempted)await fs.writeFile('/state/retry-reconcile.json',JSON.stringify(results.at(-1)),{mode:0o600});
   if(result.status==='VERIFIED')await fs.unlink('/state/retry-inflight.json');
   if(result.status==='VERIFIED'&&control.mode==='AUTO_CANARY')await fs.writeFile('/state/retry-control.json',JSON.stringify({...control,mode:'AUTO',promotedAt:new Date().toISOString(),verifiedOrderId:plan.orderId}),{mode:0o600});
  }catch(error){
   const result={at:new Date().toISOString(),orderId:plan.orderId,issueId:plan.issueId,...executionFailure({saveAttempted,error})};
   if(saveAttempted)await fs.writeFile('/state/retry-reconcile.json',JSON.stringify(result),{mode:0o600});
   await fs.appendFile('/state/retry-audit.jsonl',JSON.stringify(result)+'\n',{mode:0o600});results.push(result);
  }
 }
 return {...observation,mode:control.mode,executionEnabled:true,writes:results.filter(r=>r.saveAttempted).length,verified:results.filter(r=>r.status==='VERIFIED').length,results};
}
