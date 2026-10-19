import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadProviderEnv} from './worker.mjs';
import {captureRetryEvidence} from './capture.mjs';
import {runAcceptedDiscount} from '../../autoconfirm/src/workflows/accepted-discount-support.mjs';
import {readCandidate} from '../../autoconfirm/src/workflows/accepted-discount-runtime.mjs';
import {createSupportGmail} from '../../autoconfirm/src/clients/discount-support-gmail.mjs';
import {getIncidentChatMessages} from '../../autoconfirm/src/clients/chatby.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {selectRows} from '../../autoconfirm/src/clients/supabase.mjs';
import {getTemplateDelivery,claimTemplateDelivery,finishTemplateDelivery} from '../../autoconfirm/src/db/supabase-store.mjs';
import {executeDropeaV2Resolution,loadDropeaV2IssueActionStoreConfigs,readDropeaV2IssueOperation} from '../../autoconfirm/src/clients/dropea-v2-issue-actions.mjs';
import {readDropeaV2ReturnIssueState} from '../../autoconfirm/src/clients/dropea-v2-incidents.mjs';
import {verifyDropeaResolution,buildDropeaResolutionBody} from '../../autoconfirm/src/clients/dropea-v2-resolution-contract.mjs';

export async function supportCycle({enabled,checkMail,readCases,execute}){
 if(!enabled)return {status:'DISABLED',checked:0,results:[]};
 // Authentication failures must not reserve a customer's irreversible claim.
 try{await checkMail();}catch{return {status:'GMAIL_REAUTHORIZATION_REQUIRED',checked:0,results:[]};}
 const cases=await readCases();const results=[];
 for(const incident of cases){
  try{results.push({orderId:incident.orderId,...await execute(incident)});}
  catch{results.push({orderId:incident.orderId,status:'CASE_FAILED_REVIEW_REQUIRED'});break;}
  if(results.at(-1).mailId||results.at(-1).status==='RECONCILIATION_REQUIRED')break;
 }
 return {status:results.length?'COMPLETED':'WAITING_ELIGIBLE_CASE',checked:results.length,results};
}

export async function runVpsSupportCycle(context){
 let settings;try{settings=JSON.parse(await fs.readFile('/state/support-env.json','utf8'));}
 catch{return {status:'CONNECTIONS_REQUIRED',checked:0,results:[]};}
 if(settings.DISCOUNT_SUPPORT_ENABLED!=='true')return {status:'DISABLED',checked:0,results:[]};
 await loadProviderEnv();
 const env={...process.env,...settings};
 if(env.DISCOUNT_GMAIL_FROM!=='smnsuleia@gmail.com')throw Error('SENDER_MISMATCH');
 // Validate the write credential before sending an email or reserving a claim.
 loadDropeaV2IssueActionStoreConfigs(env);
 const mail=createSupportGmail({env});
 const args=p=>({storeId:'suleia',orderId:p.orderId,templateName:'accepted_discount_support_v1',provider:'gmail_then_dropea',chatbyUserNs:p.conversationId});
 async function capture(p){
  const messages=await getIncidentChatMessages(p.conversationId),proofs=[],attachments=[];
  for(const [label,id,at]of [['oferta',p.offerMessageId,p.offerAt],['aceptacion',p.acceptanceMessageId,p.acceptedAt]]){
   const m=messages.find(m=>String(m.id)===id);if(!m)throw Error('MESSAGE_REQUIRED');
   const proof=await captureRetryEvidence(context,{...p,phone:p.phone.slice(3),messageId:id,messageAt:at,text:addressMessageText(m)});
   const bytes=await fs.readFile(proof.path);
   if(!proof.verified||createHash('sha256').update(bytes).digest('hex')!==proof.sha256||Object.values(proof.visible).some(v=>v!==true))throw Error('PROOF_REQUIRED');
   proofs.push(proof);attachments.push({filename:`ES${p.orderId}-${label}.png`,mimeType:'image/png',bytes});
  }
  return {...p,source:'CHATBY_BROWSER_SCREENSHOT',capturedAt:proofs.map(p=>p.at).sort()[0],visiblePhone:true,visibleDateTime:true,visibleOffer:true,visibleAcceptance:true,attachments};
 }
 return supportCycle({enabled:true,checkMail:()=>mail.check(),readCases:async()=>{
  const cache=(await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value,updated_at'},limit:1}))[0];
  if(!Number.isFinite(Date.parse(cache?.updated_at))||Date.now()-Date.parse(cache.updated_at)>45*60000)throw Error('INCIDENT_CACHE_STALE');
  return (cache.value.incidents||[]).filter(i=>i.incidentDiscountResponseStatus==='DISCOUNT_ACCEPTED'&&i.chatbyUserNs);
 },execute:async incident=>runAcceptedDiscount(incident,{
  ready:()=>true,read:async i=>{
   const shared=await getTemplateDelivery({storeId:'suleia',orderId:i.orderId,templateName:`incident_resolution_v1:${i.incidenceId}`,provider:'dropea'});
   if(shared)throw Error('INCIDENT_ALREADY_CLAIMED');
   return readCandidate(i,env);
  },get:p=>getTemplateDelivery(args(p)),capture,claim:p=>claimTemplateDelivery(args(p)),
  save:(p,status,raw)=>finishTemplateDelivery({...args(p),status,attemptedAt:raw.requestedAt,sentAt:status==='verified'?raw.verifiedAt:null,raw}),
  send:(p,a)=>mail.send(p,a),verifyMail:(id,p,a)=>mail.verify(id,p,a),
  solve:async p=>{
   const shared={storeId:'suleia',orderId:p.orderId,templateName:`incident_resolution_v1:${p.issueId}`,provider:'dropea'};
   const claim=await claimTemplateDelivery(shared);if(!claim.acquired||!claim.persistent)throw Error('INCIDENT_ALREADY_CLAIMED');
   const attemptedAt=new Date().toISOString();
   await finishTemplateDelivery({...shared,status:'applied_unverified',attemptedAt,raw:{owner:'accepted_discount_support_v1',orderId:p.orderId,issueId:p.issueId}});
   await executeDropeaV2Resolution(p.issueId,'PROVIDE_SOLUTION',{note:p.solution},{env,idempotencyNonce:'accepted-support-'+p.key});
  },
  verifySolution:async p=>{
   const current=await readDropeaV2ReturnIssueState({orderId:p.orderId,incidenceId:p.issueId},{includeOrder:true});
   const operation=await readDropeaV2IssueOperation(p.issueId,'accepted-support-'+p.key,{env});
   const verified=operation?.status==='completed'&&verifyDropeaResolution(current,{issueId:p.issueId,orderId:p.orderId,action:'PROVIDE_SOLUTION',body:buildDropeaResolutionBody('PROVIDE_SOLUTION',{note:p.solution})});
   if(verified)await finishTemplateDelivery({storeId:'suleia',orderId:p.orderId,templateName:`incident_resolution_v1:${p.issueId}`,provider:'dropea',status:'verified',sentAt:new Date().toISOString(),raw:{owner:'accepted_discount_support_v1',verified:true,orderId:p.orderId,issueId:p.issueId}});
   return verified;
  }
 },{activationAt:env.DISCOUNT_SUPPORT_ACTIVATION_AT})});
}
