import {extractWamid,isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {findAddressDetailsReadback} from '../../autoconfirm/src/workflows/address-observed-executor.mjs';
const sameText=(a,b)=>String(a||'').replace(/\s+/g,' ').trim()===String(b||'').replace(/\s+/g,' ').trim();

export function verifiedDeliverySolution(raw,plan,attemptedAt){
 return String(raw?.id)===plan.issueId&&String(raw?.order_id)===plan.orderId&&raw.status==='RESOLVED'&&
  raw.resolution_status==='SOLUTION_PROVIDED'&&sameText(raw.resolution_note,plan.note)&&
  Number.isFinite(Date.parse(raw.resolution_changed_at))&&Date.parse(raw.resolution_changed_at)>=Date.parse(attemptedAt)-1000;
}

export async function sendDeliveryReplyOnce(plan,content,purpose,deps){
 const key={storeId:'suleia',orderId:plan.orderId,templateName:`incident_delivery_${purpose}_v1:${plan.issueId}`,provider:'chatby',chatbyUserNs:plan.conversationId};
 const fresh=await deps.revalidate();
 if(!fresh?.eligible||fresh.hash!==plan.hash)return {status:'BLOCKED',reason:'LATE_CUSTOMER_RESPONSE'};
 const messages=await deps.readMessages(plan.conversationId);
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
 const last=await deps.revalidate();
 if(!last?.eligible||last.hash!==plan.hash){await deps.finishMessage({...key,status:'aborted',attemptedAt,raw:{reason:'LATE_CUSTOMER_RESPONSE'}});return {status:'BLOCKED',reason:'LATE_CUSTOMER_RESPONSE'};}
 // Persist before the only send attempt. An uncertain response is read back,
 // never retried. No template/flow is created or edited.
 const persisted=await deps.finishMessage({...key,status:'delivery_unverified',attemptedAt,raw:{owner:'vps_delivery_reply',purpose,contextHash:plan.hash}});
 if(persisted?.skipped)throw Error('MESSAGE_DURABLE_JOURNAL_REQUIRED');
 let receipt=null;try{receipt=await deps.send({user_ns:plan.conversationId,content});}catch{}
 let mid=null;
 for(let n=0;n<3&&!mid;n++){
  if(n&&deps.waitForReadback)await deps.waitForReadback();
  const after=await deps.readMessages(plan.conversationId).catch(()=>[]);
  mid=findAddressDetailsReadback(after,{content,userNs:plan.conversationId,attemptedAt});
 }
 const result={status:mid?'VERIFIED':'RECONCILE',reason:mid?null:'MESSAGE_DELIVERY_REQUIRES_REVIEW',providerReceipt:Boolean(extractWamid(receipt))};
 await deps.finishMessage({...key,status:mid?'sent':'delivery_unverified',attemptedAt,sentAt:mid?attemptedAt:null,raw:{owner:'vps_delivery_reply',purpose,messageId:mid,...result}});
 return result;
}

export async function executeDeliveryReply(plan,deps){
 if(!plan?.eligible)return {status:'BLOCKED',reason:plan?.reason||'NO_PLAN'};
 const fresh=await deps.revalidate();
 if(!fresh?.eligible||fresh.hash!==plan.hash)return {status:'BLOCKED',reason:'EVIDENCE_CHANGED'};
 if(plan.kind==='CLARIFY')return {...await sendDeliveryReplyOnce(plan,plan.content,'clarify',deps),action:'CLARIFICATION'};
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
