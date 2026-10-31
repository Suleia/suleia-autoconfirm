import {getTemplateDelivery,claimTemplateDelivery,finishTemplateDelivery} from '../../autoconfirm/src/db/supabase-store.mjs';
import {updateRows} from '../../autoconfirm/src/clients/supabase.mjs';
import {evaluatePreCanaryGate,evaluatePromotionGate} from '../../autoconfirm/src/customer-context/release-gates.mjs';
import {deliveryReplyMessageKey} from './delivery-reply-executor.mjs';
const administrativeId='__conversation_v3_release__'; // Ledger metadata, never a provider order/customer.
const key=capability=>({storeId:'suleia',orderId:administrativeId,templateName:`conversation_v3_capability_v1:${capability}`,provider:'internal_release_gate'});
const breakerKey={storeId:'suleia',orderId:administrativeId,templateName:'conversation_v3_p0_breaker_v1',provider:'internal_release_gate'};
const defaults={get:getTemplateDelivery,claim:claimTemplateDelivery,finish:finishTemplateDelivery,cas:updateRows};
const pin=plan=>({case_key:`${plan.orderId}:${plan.issueId}`,conversation_id:plan.conversationId,input_hash:plan.care_plan.input_hash,case_hash:plan.care_plan.case_hash});
const same=(a,b)=>a?.case_key===b.case_key&&a?.conversation_id===b.conversation_id&&a?.input_hash===b.input_hash&&a?.case_hash===b.case_hash;
export async function admitConversationV3(plan,control,deps=defaults){
 if(control.mode!=='LIVE'||!control.authorizationRef||!evaluatePreCanaryGate(control.releaseReport).allowed)return null;
 const capability=plan.care_capability;if(!['STATUS_REPLY','CONTEXTUAL_CLARIFICATION'].includes(capability))return null;
 if(capability==='CONTEXTUAL_CLARIFICATION'&&plan.care_plan.missing_information.length!==1){
  const previous=await deps.get(key(capability));if(previous?.status!=='verified')return null;
 }
 if((await deps.get(breakerKey))?.status==='disabled_p0')return null;
 const args=key(capability),selected=pin(plan);let row=await deps.get(args);
 const raw={capability,authorization_ref:control.authorizationRef,persistent:true,...selected,send_attempts:0,reserved_at:new Date().toISOString(),message_key:deliveryReplyMessageKey(plan,capability==='STATUS_REPLY'?'status':'clarify')};
 if(!row){
  const claim=await deps.claim(args);if(!claim?.persistent)return null;
  if(claim.acquired){
   const saved=await deps.finish({...args,status:'canary_reserved',attemptedAt:claim.row?.attempted_at,raw});
   if(saved?.skipped)throw Error('V3_CAPABILITY_JOURNAL_UNAVAILABLE');row={status:'canary_reserved',raw};
  }else row=claim.existing;
 }else if((row.status==='canary_aborted'&&row.raw?.not_sent===true&&row.raw?.send_attempts===0)||
  (row.status==='canary_reserved'&&Date.now()-Date.parse(row.raw?.reserved_at)>300000&&row.raw?.send_attempts===0&&row.raw.message_key&&!(await deps.get(row.raw.message_key)))){
  if(await deps.get(raw.message_key))return null;
  const updated=await deps.cas('template_delivery_ledger',{status:'canary_reserved',raw,updated_at:new Date().toISOString()},{query:{template_key:'eq.'+row.template_key,status:'eq.'+row.status,updated_at:'eq.'+row.updated_at},returning:'representation'});
  if(updated?.length!==1)return null;row=updated[0];
 }
 if(row?.raw?.authorization_ref!==control.authorizationRef)return null;
 if(row.status==='verified'&&evaluatePromotionGate({...control.releaseReport,...row.raw.proof}).allowed)return {...row.raw,stage:'PROMOTED'};
 if(row.status==='canary_reserved'&&same(row.raw,selected))return {...row.raw,stage:'CANARY'};
 return null; // Sending/unknown/outcome without proof can never reserve again.
}
export async function disableConversationV3Replies(code,plan,deps=defaults){
 const allowed=['DUPLICATE_V3_MESSAGE','WRONG_RECIPIENT','WRONG_ORDER_BINDING','WRONG_OWNER','WRONG_IRREVERSIBLE_ROUTE','BLIND_RETRY','CONFIRMED_STALE_PLAN_WRITE'];
 if(!allowed.includes(code))return false;
 const saved=await deps.finish({...breakerKey,status:'disabled_p0',raw:{code,at:new Date().toISOString(),case_key:`${plan.orderId}:${plan.issueId}`,memory_preserved:true,legacy_continues:true}});
 if(saved?.skipped)throw Error('V3_P0_BREAKER_PERSISTENCE_REQUIRED');return true;
}
export async function verifyConversationV3Admission(plan,control,deps=defaults){
 if((await deps.get(breakerKey))?.status==='disabled_p0')throw Error('V3_P0_REPLY_BREAKER_ACTIVE');
 const row=await deps.get(key(plan.care_capability));
 if(row?.raw?.authorization_ref!==control.authorizationRef)throw Error('V3_RELEASE_AUTHORIZATION_CHANGED');
 if(plan.care_admission.stage==='CANARY'){
  if(row.status!=='canary_sending'||row.raw.send_attempts!==1||!same(row.raw,pin(plan)))throw Error('V3_EXACT_CANARY_RESERVATION_CHANGED');
 }else if(row.status!=='verified'||!evaluatePromotionGate({...control.releaseReport,...row.raw.proof}).allowed)throw Error('V3_CAPABILITY_PROMOTION_CHANGED');
}
export async function recordConversationV3Release(plan,receipt,control,deps=defaults){
 if(!plan.care_admission)return;
 if(receipt.raw?.p0_code)await disableConversationV3Replies(receipt.raw.p0_code,plan,deps);
 if(plan.care_admission.stage!=='CANARY')return;
 const args=key(plan.care_capability),row=await deps.get(args);
 if(!same(row?.raw,pin(plan)))throw Error('V3_CAPABILITY_RECEIPT_IDENTITY_CHANGED');
 let status=row.status,raw={...row.raw};
 if(receipt.status==='delivery_unverified'){status='canary_sending';raw.send_attempts=1;}
 if(receipt.status==='aborted'&&receipt.raw?.notSent===true){status='canary_aborted';raw={...raw,send_attempts:0,not_sent:true};}
 if(receipt.status==='already_seen'){status='canary_aborted';raw={...raw,send_attempts:0,not_sent:true};}
 if(receipt.status==='sent'){
  const proof={capability:plan.care_capability,canary_capability:plan.care_capability,canary_executed:receipt.status==='sent'&&receipt.raw?.sendAttempts===1,canary_exact_case:true,
   provider_receipt_verified:receipt.raw?.providerReceipt===true,conversation_readback_verified:!!receipt.raw?.messageId&&receipt.raw?.readbackVerified===true,
   current_evidence_revalidated:receipt.raw?.beforeDispatchVerified===true,send_attempts:receipt.raw?.sendAttempts,
   wrong_recipient:receipt.raw?.p0_code==='WRONG_RECIPIENT'?1:0,duplicate_send:receipt.raw?.p0_code==='DUPLICATE_V3_MESSAGE'?1:0,blind_retry:0,uncertain_write_replayed:0};
  raw={...raw,proof,provider_message_id:receipt.raw?.messageId,verified_at:new Date().toISOString()};
  status=!receipt.raw?.p0_code&&evaluatePromotionGate({...control.releaseReport,...proof}).allowed?'verified':'canary_readback_without_promotion';
 }
 const saved=await deps.finish({...args,status,attemptedAt:receipt.attemptedAt,sentAt:receipt.sentAt,raw});
 if(saved?.skipped)throw Error('V3_CAPABILITY_RECEIPT_UNAVAILABLE');
}
