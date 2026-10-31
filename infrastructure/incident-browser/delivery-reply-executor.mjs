import {extractWamid,isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {findAddressDetailsReadback} from '../../autoconfirm/src/workflows/address-observed-executor.mjs';
import {createHash} from 'node:crypto';
import {hash} from '../../autoconfirm/src/customer-care/context.mjs';
const sameText=(a,b)=>String(a||'').replace(/\s+/g,' ').trim()===String(b||'').replace(/\s+/g,' ').trim();
export const solutionNoteHash=note=>createHash('sha256').update(String(note||'').replace(/\s+/g,' ').trim()).digest('hex');

export function verifiedDeliverySolutionState(raw,plan,attemptedAt){
 return String(raw?.id)===plan.issueId&&String(raw?.order_id)===plan.orderId&&raw.status==='RESOLVED'&&
  raw.resolution_status==='SOLUTION_PROVIDED'&&
  Number.isFinite(Date.parse(raw.resolution_changed_at))&&Date.parse(raw.resolution_changed_at)>=Date.parse(attemptedAt)-1000;
}
export function verifiedDeliverySolution(raw,plan,attemptedAt,noteEvidence=null){
 const persistedNote=sameText(raw?.resolution_note,plan.note)||noteEvidence?.provider==='DROPEA_PERSISTED_DETAIL'&&
  noteEvidence.verified===true&&noteEvidence.orderId===plan.orderId&&noteEvidence.issueId===plan.issueId&&
  noteEvidence.noteHash===solutionNoteHash(plan.note)&&Number.isFinite(Date.parse(noteEvidence.observedAt))&&
  Date.parse(noteEvidence.observedAt)>=Date.parse(attemptedAt)-1000;
 return verifiedDeliverySolutionState(raw,plan,attemptedAt)&&persistedNote;
}

export function deliveryReplyMessageKey(plan,purpose){
 const phase=purpose==='clarify'||plan.care_plan?.version==='CONVERSATION_V3'?`:${plan.reason}`:'';
 return {storeId:'suleia',orderId:plan.orderId,templateName:purpose==='discount_amount'?'accepted_discount_amount_notice_v1':`incident_delivery_${purpose}_v1:${plan.issueId}${phase}`,provider:'chatby',chatbyUserNs:plan.conversationId};
}
export async function sendDeliveryReplyOnce(plan,content,purpose,deps){
 const key=deliveryReplyMessageKey(plan,purpose);
 const guarded=!!plan.care_admission&&deps.guardedDispatch===true;
 if(plan.care_admission&&!guarded)return {status:'BLOCKED',reason:'V3_FINAL_DISPATCH_GUARD_REQUIRED'};
 const fresh=guarded?plan:await deps.revalidate();
 if(!fresh?.eligible||fresh.hash!==plan.hash)return {status:'BLOCKED',reason:'LATE_CUSTOMER_RESPONSE'};
 const messages=guarded&&Array.isArray(deps.initialMessages)?deps.initialMessages:await deps.readMessages(plan.conversationId);
 const seen=messages.find(m=>!isCustomerInteraction(m)&&String(m.user_ns)===plan.conversationId&&extractWamid(m)&&
  messageTimestamp(m)>=Date.parse(plan.messageAt)&&sameText(addressMessageText(m),content));
 const claim=await deps.claimMessage(key);
 if(!claim?.persistent)return {status:'BLOCKED',reason:'MESSAGE_DURABLE_CLAIM_REQUIRED'};
 if(!claim.acquired){
  if(['sent','already_seen'].includes(claim.existing?.status))return {status:'VERIFIED',alreadySent:true};
  const row=claim.existing;
  const mid=row?.attempted_at?findAddressDetailsReadback(messages,{content,userNs:plan.conversationId,attemptedAt:row.attempted_at}):null;
  if(mid){await deps.finishMessage({...key,status:'sent',attemptedAt:row.attempted_at,sentAt:row.attempted_at,raw:{owner:'vps_delivery_reply',messageId:mid,reason:'RECONCILED_WITHOUT_RESEND'}});return {status:'VERIFIED',reconciled:true};}
  return {status:'RECONCILE',reason:'MESSAGE_ALREADY_CLAIMED_NO_RESEND'};
 }
 const attemptedAt=new Date(deps.now?.()||Date.now()).toISOString();
 if(seen){await deps.finishMessage({...key,status:'already_seen',attemptedAt,sentAt:new Date(messageTimestamp(seen)).toISOString(),raw:{owner:'vps_delivery_reply',messageId:extractWamid(seen)}});return {status:'VERIFIED',alreadySent:true};}
 const last=guarded?plan:await deps.revalidate();
 if(!last?.eligible||last.hash!==plan.hash){await deps.finishMessage({...key,status:'aborted',attemptedAt,raw:{reason:'LATE_CUSTOMER_RESPONSE',notSent:true}});return {status:'BLOCKED',reason:'LATE_CUSTOMER_RESPONSE'};}
 // Persist before the only send attempt. An uncertain response is read back,
 // never retried. No template/flow is created or edited.
 const persisted=await deps.finishMessage({...key,status:'delivery_unverified',attemptedAt,raw:{owner:'vps_delivery_reply',purpose,contextHash:plan.hash}});
 if(persisted?.skipped)throw Error('MESSAGE_DURABLE_JOURNAL_REQUIRED');
 let receipt=null,uncertainDispatch=null;try{receipt=await deps.send({user_ns:plan.conversationId,content});}catch(error){
  if(plan.care_plan?.version==='CONVERSATION_V3'&&error?.notSent===true){
   const reason=/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'V3_PRE_DISPATCH_REVALIDATION_FAILED';
   await deps.finishMessage({...key,status:'aborted',attemptedAt,raw:{owner:'vps_delivery_reply',reason,notSent:true}});return {status:'BLOCKED',reason,notSent:true};
  }
  uncertainDispatch=error;
 }
 let mid=null,duplicate=false,confirmedStale=false,matchedIds=[];
 for(let n=0;n<3&&!mid;n++){
  if(n&&deps.waitForReadback)await deps.waitForReadback();
  const after=await deps.readMessages(plan.conversationId).catch(()=>[]);
  mid=findAddressDetailsReadback(after,{content,userNs:plan.conversationId,attemptedAt});
  if(plan.care_plan?.version==='CONVERSATION_V3'){
   matchedIds=[...new Set(after.map(m=>findAddressDetailsReadback([m],{content,userNs:plan.conversationId,attemptedAt})).filter(Boolean))];duplicate=matchedIds.length>1;
   const dispatchedAt=Date.parse(receipt?.v3_dispatched_at||uncertainDispatch?.v3_dispatched_at);
   if(Number.isFinite(dispatchedAt)){
    confirmedStale=after.some(m=>{
     const at=messageTimestamp(m);if(!isCustomerInteraction(m)||at>dispatchedAt||at<Date.parse(plan.care_plan.order_created_at))return false;
     const id=String(m.id||m.mid||hash(m)),signature=hash([id,at,addressMessageText(m),m.payload?.reply_to_mid]);
     return plan.care_plan.event_versions?.[id]!==signature;
    });
   }
  }
 }
 const receiptRecipient=receipt?.data?.user_ns||receipt?.user_ns;
 const p0=duplicate?'DUPLICATE_V3_MESSAGE':confirmedStale?'CONFIRMED_STALE_PLAN_WRITE':plan.care_plan?.version==='CONVERSATION_V3'&&receiptRecipient&&receiptRecipient!==plan.conversationId?'WRONG_RECIPIENT':null;
 const result={status:mid&&!p0?'VERIFIED':'RECONCILE',reason:p0||(!mid?'MESSAGE_DELIVERY_REQUIRES_REVIEW':null),providerReceipt:Boolean(extractWamid(receipt)),
  ...(plan.care_plan?.version==='CONVERSATION_V3'?{sendAttempts:1,readbackVerified:!!mid&&!duplicate,beforeDispatchVerified:receipt?.v3_dispatch_verified===true||uncertainDispatch?.v3_dispatch_verified===true,dispatchedAt:receipt?.v3_dispatched_at||uncertainDispatch?.v3_dispatched_at||null,p0_code:p0,...(duplicate?{duplicateMessageIds:matchedIds}:{})}:{} )};
 await deps.finishMessage({...key,status:mid?'sent':'delivery_unverified',attemptedAt,sentAt:mid?attemptedAt:null,raw:{owner:'vps_delivery_reply',purpose,messageId:mid,...result}});
 return result;
}

export async function executeDeliveryReply(plan,deps){
 if(!plan?.eligible)return {status:'BLOCKED',reason:plan?.reason||'NO_PLAN'};
 const fresh=plan.care_admission&&deps.guardedDispatch===true?plan:await deps.revalidate();
 if(!fresh?.eligible||fresh.hash!==plan.hash)return {status:'BLOCKED',reason:'EVIDENCE_CHANGED'};
 if(plan.kind==='CLARIFY'){
  const status=plan.care_plan?.version==='CONVERSATION_V3'&&plan.care_capability==='STATUS_REPLY';
  return {...await sendDeliveryReplyOnce(plan,plan.content,status?'status':'clarify',deps),action:status?'STATUS_REPLY':'CLARIFICATION'};
 }
 if(plan.acknowledgement){
  const result=await sendDeliveryReplyOnce(plan,plan.acknowledgement,'ack',deps);
  if(result.status!=='VERIFIED')return {...result,action:'ACKNOWLEDGEMENT'};
 }
 const claim=await deps.claimSolution(plan);
 if(!claim?.acquired||claim.persistent!==true)return {status:'RECONCILE',reason:'SHARED_ISSUE_CLAIM_EXISTS_NO_RESEND'};
 const last=await deps.revalidate();
 if(!last?.eligible||last.hash!==plan.hash){await deps.finishSolution('aborted',plan);return {status:'BLOCKED',reason:'LATE_CUSTOMER_RESPONSE'};}
 await deps.finishSolution('applied_unverified',plan);
 const attemptedAt=new Date(deps.now?.()||Date.now()).toISOString();
 await deps.journal(plan,attemptedAt); // A restart reconciles this write, never replays it.
 try{await deps.writeSolution(plan);}catch{}
 const verified=await deps.verifySolution(plan,attemptedAt).catch(()=>false);
 await deps.finishSolution(verified?'verified':'applied_unverified',plan,attemptedAt);
 if(verified)await deps.clearJournal();
 return {status:verified?'VERIFIED':'RECONCILE',action:'PROVIDE_SOLUTION',solutionAttempted:true,verified,attemptedAt};
}
