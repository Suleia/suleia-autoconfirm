import fs from 'node:fs/promises';
import {loadProviderEnv,observeRetryCandidates} from './worker.mjs';
import {retryEvidencePlan,executeEvidenceRetry} from './retry-policy.mjs';
import {captureRetryEvidence} from './capture.mjs';
import {prepareRetry,readEvidenceDetail} from './dropea-ui.mjs';

export function verifiedProviderRetry(raw,plan,attemptedAt){
 return String(raw?.id)===plan.issueId&&String(raw?.order_id)===plan.orderId&&raw.status==='RESOLVED'&&raw.resolution_status==='RETRY'
  &&raw.resolution_data?.date===plan.date&&raw.resolution_data?.time_window===plan.time_window
  &&Number.isFinite(Date.parse(raw.resolution_changed_at))&&Date.parse(raw.resolution_changed_at)>=Date.parse(attemptedAt)-1000;
}
const claimArgs=plan=>({storeId:'suleia',orderId:plan.orderId,templateName:`incident_resolution_v1:${plan.issueId}`,provider:'dropea'});
export async function runVpsRetryCycle(context){
 await loadProviderEnv();
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
 const candidates=report.cases.filter(c=>c.eligible).slice(0,1);
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
   const result=await executeEvidenceRetry(plan,{
    revalidate,capture:p=>captureRetryEvidence(context,p),claim:p=>claimTemplateDelivery(claimArgs(p)),
    finish:async(status,p)=>{
     const result=await finishTemplateDelivery({...claimArgs(p),status,attemptedAt,sentAt:status==='verified'?new Date().toISOString():null,
      raw:{owner:'vps_retry_evidence',reason:'EXACT_ORDER_FUTURE_RETRY_WITH_SCREENSHOT',orderId:p.orderId,issueId:p.issueId,date:p.date,time_window:p.time_window,at:new Date().toISOString(),status}});
     if(result?.skipped)throw Error('PERSISTENT_LEDGER_REQUIRED');
    },
    write:async(p,proof)=>{
     const draft=await prepareRetry(context,p,proof);
     const latest=await revalidate();
     if(!latest.eligible||latest.hash!==p.hash){await draft.cancel();throw Error('LATE_REPLY');}
     attemptedAt=new Date().toISOString();
     await fs.appendFile('/state/retry-audit.jsonl',JSON.stringify({at:attemptedAt,orderId:p.orderId,issueId:p.issueId,reason:'EXACT_ORDER_FUTURE_RETRY_WITH_SCREENSHOT',result:'ATTEMPTING',proof:proof.sha256})+'\n',{mode:0o600});
     saveAttempted=true;await draft.save();
    },
    verify:async p=>{
     if(!saveAttempted)return false;
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
   });
   results.push({orderId:plan.orderId,issueId:plan.issueId,saveAttempted,...result});
   await fs.appendFile('/state/retry-audit.jsonl',JSON.stringify({at:new Date().toISOString(),orderId:plan.orderId,issueId:plan.issueId,...result})+'\n',{mode:0o600});
   if(result.status==='RECONCILE'&&result.reason!=='EXISTING_OR_UNAVAILABLE_CLAIM')await fs.writeFile('/state/retry-reconcile.json',JSON.stringify(results.at(-1)),{mode:0o600});
   if(result.status==='VERIFIED'&&control.mode==='AUTO_CANARY')await fs.writeFile('/state/retry-control.json',JSON.stringify({mode:'AUTO',promotedAt:new Date().toISOString(),verifiedOrderId:plan.orderId}),{mode:0o600});
  }catch{
   const result={at:new Date().toISOString(),orderId:plan.orderId,issueId:plan.issueId,saveAttempted,status:'RECONCILE',reason:'EXECUTION_INTERRUPTED'};
   await fs.writeFile('/state/retry-reconcile.json',JSON.stringify(result),{mode:0o600});results.push(result);
  }
 }
 return {...observation,mode:control.mode,executionEnabled:true,writes:results.filter(r=>r.saveAttempted).length,verified:results.filter(r=>r.status==='VERIFIED').length,results};
}
