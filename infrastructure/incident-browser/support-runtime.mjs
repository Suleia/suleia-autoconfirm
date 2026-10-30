import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadProviderEnv} from './worker.mjs';
import {captureRetryEvidence} from './capture.mjs';
import {runAcceptedDiscount,acceptedDiscountPlan} from '../../autoconfirm/src/workflows/accepted-discount-support.mjs';
import {readCandidate} from '../../autoconfirm/src/workflows/accepted-discount-runtime.mjs';
import {createSupportGmail} from '../../autoconfirm/src/clients/discount-support-gmail.mjs';
import {getIncidentChatMessages,loadSubscriberIndex,findSubscriberInIndexForExactOrder} from '../../autoconfirm/src/clients/chatby.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {selectRows,upsertRows} from '../../autoconfirm/src/clients/supabase.mjs';
import {getTemplateDelivery,claimTemplateDelivery,finishTemplateDelivery} from '../../autoconfirm/src/db/supabase-store.mjs';
import {executeDropeaV2Resolution,loadDropeaV2IssueActionStoreConfigs,readDropeaV2IssueOperation} from '../../autoconfirm/src/clients/dropea-v2-issue-actions.mjs';
import {readDropeaV2ReturnIssueState} from '../../autoconfirm/src/clients/dropea-v2-incidents.mjs';
import {verifyDropeaResolution,buildDropeaResolutionBody} from '../../autoconfirm/src/clients/dropea-v2-resolution-contract.mjs';
import {reconcileVerifiedSupport,selectSupportCandidates,sameSpanishSupportPhone,supportCaseKey as caseKey,SUPPORT_FEEDBACK_KEY,supportFeedbackProjection} from './support-reconciliation.mjs';
import {reconcilePendingSupport} from './support-pending-reconciliation.mjs';
import {sendAcceptedDiscountAmountOnce} from './accepted-discount-amount-notice.mjs';

export async function supportCycle({enabled,checkMail,readCases,execute}){
 if(!enabled)return {status:'DISABLED',checked:0,results:[]};
 // Authentication failures must not reserve a customer's irreversible claim.
 try{await checkMail();}catch{return {status:'GMAIL_REAUTHORIZATION_REQUIRED',checked:0,results:[]};}
 let cases;try{cases=await readCases();}catch{return {status:'SUPPORT_CASE_READ_FAILED',checked:0,results:[]};}
 const results=[];
 for(const incident of cases){
  try{results.push({orderId:incident.orderId,currentIssueId:String(incident.incidenceId||''),...await execute(incident)});}
  catch(error){results.push({orderId:incident.orderId,currentIssueId:String(incident.incidenceId||''),status:'CASE_FAILED_REVIEW_REQUIRED',
   reason:/^[A-Z0-9_]{1,100}$/.test(error?.message||'')?error.message:'CASE_EXECUTION_FAILED',needsHumanReview:true});break;}
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
 let previousFeedback={cases:[]},pendingCases=[],knownByCase=new Map(),feedbackSourceRead=false,reconciliationIndexPromise;
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
 const result=await supportCycle({enabled:true,checkMail:()=>mail.check(),readCases:async()=>{
  const states=await selectRows('app_state',{query:{key:`in.(incidents_cache,${SUPPORT_FEEDBACK_KEY})`,select:'key,value,updated_at'},limit:2});
  const cache=states.find(r=>r.key==='incidents_cache');
  if(!Number.isFinite(Date.parse(cache?.updated_at))||Date.now()-Date.parse(cache.updated_at)>45*60000)throw Error('INCIDENT_CACHE_STALE');
  previousFeedback=states.find(r=>r.key===SUPPORT_FEEDBACK_KEY)?.value||{cases:[]};
  if(!Array.isArray(previousFeedback.cases))previousFeedback={cases:[]};
  pendingCases=(cache.value.incidents||[]).filter(i=>i.chatbyUserNs&&['PENDING','PENDIENTE'].includes(String(i.issueStatus||'PENDING').toUpperCase()));
  const selected=await selectSupportCandidates(pendingCases,previousFeedback.cases,i=>getTemplateDelivery(args({orderId:i.orderId,conversationId:i.chatbyUserNs})));
  knownByCase=selected.knownByCase;feedbackSourceRead=true;
  return selected.candidates;
 },execute:async incident=>{
  const known=knownByCase.get(caseKey(incident));
  if(known?.status==='verified')return reconcileVerifiedSupport(incident,known,{
   readCurrent:i=>readDropeaV2ReturnIssueState(i,{includeOrder:true,env}),
   readShared:i=>getTemplateDelivery({storeId:'suleia',orderId:i.orderId,templateName:`incident_resolution_v1:${i.incidenceId}`,provider:'dropea'}),
   readConversation:async(i,order)=>{
    // One fresh index per bounded observation batch; provider orders and each
    // conversation's complete message history are still read per case.
    reconciliationIndexPromise ||=loadSubscriberIndex({maxPages:30,force:true});
    const subscriber=findSubscriberInIndexForExactOrder(await reconciliationIndexPromise,{phone:order.customerPhone,orderId:order.orderId});
    const sameConversation=Boolean(subscriber&&subscriber.user_ns===i.chatbyUserNs);
    return {exactOrder:Boolean(subscriber),sameConversation,samePhone:sameSpanishSupportPhone(order.customerPhone,subscriber?.phone||subscriber?.user_id),
     messages:sameConversation?await getIncidentChatMessages(subscriber.user_ns):[]};
   }
  },{ownerId:env.DISCOUNT_SUPPORT_DROPSHIPPER_ID});
  if(known)return reconcilePendingSupport(incident,known,{
   readPlan:async(i,receipt)=>{
    const candidate=await readCandidate(i,env);
    return {candidate,plan:receipt.raw?.supportPlan||acceptedDiscountPlan(candidate,{activationAt:env.DISCOUNT_SUPPORT_ACTIVATION_AT})};
   },
   verifyMail:async(id,p,hashes)=>{
    if(!Array.isArray(hashes)||hashes.length!==2)return false;
    const attachments=[];
    for(const [label,messageId]of [['oferta',p.offerMessageId],['aceptacion',p.acceptanceMessageId]]){
     if(!/^[1-9]\d*$/.test(messageId))return false;
     const filename=`ES${p.orderId}-${label}.png`,expected=hashes.find(h=>h.filename===filename);
     const bytes=await fs.readFile(`/evidence/retry-${p.orderId}-${messageId}.png`);
     if(createHash('sha256').update(bytes).digest('hex')!==expected?.sha256)return false;
     attachments.push({filename,mimeType:'image/png',bytes});
    }
    return mail.verify(id,p,attachments);
   },
   readOperation:p=>readDropeaV2IssueOperation(p.issueId,'accepted-support-'+p.key,{env}),
   verifySolution:async p=>verifyDropeaResolution(await readDropeaV2ReturnIssueState({orderId:p.orderId,incidenceId:p.issueId},{includeOrder:true}),
    {issueId:p.issueId,orderId:p.orderId,action:'PROVIDE_SOLUTION',body:buildDropeaResolutionBody('PROVIDE_SOLUTION',{note:p.solution})}),
   finishVerified:async(p,receipt)=>{
    const shared={storeId:'suleia',orderId:p.orderId,templateName:`incident_resolution_v1:${p.issueId}`,provider:'dropea'};
    const row=await getTemplateDelivery(shared);
    if(!row||row.raw?.owner!=='accepted_discount_support_v1'||String(row.raw?.issueId)!==p.issueId)throw Error('SHARED_CLAIM_UNVERIFIED');
    const verifiedAt=new Date().toISOString();
    const a=await finishTemplateDelivery({...shared,status:'verified',attemptedAt:row.attempted_at,sentAt:verifiedAt,
     raw:{...row.raw,verified:true,reconciledWithoutResend:true}});if(a?.skipped)throw Error('SHARED_RECEIPT_WRITE_FAILED');
    const b=await finishTemplateDelivery({...args(p),status:'verified',attemptedAt:receipt.attempted_at,sentAt:verifiedAt,
     raw:{...receipt.raw,phase:'SOLUTION_VERIFIED',verifiedAt,discountApplied:false,reconciledWithoutResend:true}});if(b?.skipped)throw Error('SUPPORT_RECEIPT_WRITE_FAILED');
   }
  });
  if(incident.incidentDiscountResponseStatus!=='DISCOUNT_ACCEPTED')return {status:'NOT_APPLICABLE',discountApplied:false};
  return {currentIssueId:String(incident.incidenceId),...await runAcceptedDiscount(incident,{
  ready:()=>true,read:async i=>{
   const shared=await getTemplateDelivery({storeId:'suleia',orderId:i.orderId,templateName:`incident_resolution_v1:${i.incidenceId}`,provider:'dropea'});
   if(shared)throw Error('INCIDENT_ALREADY_CLAIMED');
   return readCandidate(i,env);
  },get:p=>getTemplateDelivery(args(p)),capture,claim:p=>claimTemplateDelivery(args(p)),
  notifyAmount:p=>sendAcceptedDiscountAmountOnce(p,{
   readMessages:getIncidentChatMessages,claimMessage:claimTemplateDelivery,finishMessage:finishTemplateDelivery,
   send:async value=>(await import('../../autoconfirm/src/clients/chatby.mjs')).sendTextMessage(value),
   waitForReadback:()=>new Promise(resolve=>setTimeout(resolve,1500)),
   revalidate:async()=>{
    const fresh=acceptedDiscountPlan(await readCandidate(incident,env),{activationAt:env.DISCOUNT_SUPPORT_ACTIVATION_AT});
    return {eligible:fresh.eligible,hash:fresh.snapshot};
   }
  }),
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
 },{activationAt:env.DISCOUNT_SUPPORT_ACTIVATION_AT})};}});
 // Persist only a bounded, contact-free observation. Do not change the support
 // receipt or a shared action claim while reconciling historical outcomes.
 if(feedbackSourceRead){
  const activeKeys=new Set(pendingCases.map(caseKey));
  const cases=new Map((previousFeedback.cases||[]).filter(c=>activeKeys.has(caseKey(c))).map(c=>[caseKey(c),supportFeedbackProjection(c)]));
  for(const item of result.results||[]){
   if(!item.currentIssueId)continue;
   const observation=supportFeedbackProjection({...item,checkedAt:item.checkedAt||new Date().toISOString()});
   cases.set(caseKey(item),observation);
  }
  const at=new Date().toISOString();
  try{await upsertRows('app_state',{key:SUPPORT_FEEDBACK_KEY,value:{at,reconciliationReadOnly:true,status:result.status,cases:[...cases.values()].slice(0,200)},updated_at:at},{onConflict:'key',timeoutMs:10000});}
  catch{result.feedbackPersistence='FAILED';}
 }
 return result;
}
