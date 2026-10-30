import {decorateClarification} from '../../autoconfirm/src/customer-care/clarification-adapter.mjs';
import {createCustomerCareStore} from '../../autoconfirm/src/customer-care/store.mjs';
import {careFlags} from '../../autoconfirm/src/customer-care/policy.mjs';
import {hash} from '../../autoconfirm/src/customer-care/context.mjs';

export function customerCareEnvironment(control){
 const care=control?.customerCare||{};
 return {CUSTOMER_CARE_ENABLED:care.enabled===true?'true':'false',CUSTOMER_CARE_CONTEXT_ENABLED:care.context===true?'true':'false',CUSTOMER_CARE_CLARIFICATION_ENABLED:care.clarification===true?'true':'false',CUSTOMER_CARE_STATUS_REPLY_ENABLED:care.statusReply===true?'true':'false',CUSTOMER_CARE_MODE:care.mode||'SHADOW',CUSTOMER_CARE_AI_INTERPRETER_ENABLED:'false'};
}

// Uses only the existing worker's inputs after its fresh association and prior
// return gates. This function cannot send text or call a provider action.
export async function prepareCustomerCare(legacy,input,{control,store=createCustomerCareStore(),now=Date.now()}={}){
 const env=customerCareEnvironment(control),flags=careFlags(env);
 if(!flags.enabled||!flags.context)return {plan:legacy,care:null};
 const identity={canonical_order_id:String(input.order.orderId),active_issue_id:String(input.incident.incidenceId)};
 try{
  const previous=await store.load(identity);
  const bound={...input,now,binding:{verified:true,orderId:String(input.order.orderId),issueId:String(input.incident.incidenceId),conversationId:input.incident.chatbyUserNs}};
  const result=decorateClarification(legacy,bound,{previous:previous?.value,env,canaryCase:control.customerCare.canaryCase||null});
  if(result.care)await store.save({...result.care,mode:flags.mode},previous);
  return result;
 }catch{
  // SHADOW is observational, so its failure must not block any existing lane.
  if(flags.mode==='SHADOW'||legacy?.kind!=='CLARIFY')return {plan:legacy,care:null,error:'CUSTOMER_CARE_OBSERVATION_UNAVAILABLE'};
  return {plan:{eligible:false,reason:'CUSTOMER_CARE_MEMORY_UNAVAILABLE'},care:null};
 }
}

export async function recordCustomerCareReceipt(plan,result,{store=createCustomerCareStore()}={}){
 if(!plan?.care_plan)return;
 const identity={canonical_order_id:plan.orderId,active_issue_id:plan.issueId};
 const previous=await store.load(identity);if(!previous)throw Error('CUSTOMER_CARE_STATE_MISSING');
 const state=structuredClone(previous.value);
 if(state.conversation_reference!==plan.conversationId)throw Error('CUSTOMER_CARE_RECEIPT_IDENTITY_CHANGED');
 const mid=result.raw?.messageId||null;
 const messageHash=hash(plan.content),status=['sent','already_seen'].includes(result.status)?'PROVIDER_ACCEPTED':result.status==='aborted'?'ABORTED':'DELIVERY_UNVERIFIED';
 const question={clarification_type:plan.care_plan.missing_slots.join('+')||plan.care_capability,missing_slots:plan.care_plan.missing_slots,message_hash:messageHash,sent_at:result.sentAt||result.attemptedAt,provider_message_id:mid,answered_at:null,answer_hash:null,status,source:'CUSTOMER_CARE_EXISTING_SENDER',based_on_conversation_version:plan.care_plan.conversation_version};
 // Replace only this question's in-flight projection; never clear old entries.
 state.clarifications=[...state.clarifications.filter(c=>c.message_hash!==messageHash||c.based_on_conversation_version!==question.based_on_conversation_version),question];
 state.last_outbound_message_hash=messageHash;state.last_outbound_question_type=question.clarification_type;state.last_outbound_question_at=question.sent_at;
 state.status=status==='ABORTED'?'OBSERVING':'WAITING_CUSTOMER';state.waiting_for_customer=status!=='ABORTED';state.updated_at=new Date().toISOString();
 if(status==='PROVIDER_ACCEPTED'&&plan.care_plan.response_type==='PAYMENT_INFORMATION'){state.payment_information_sent=true;state.payment_information_signature=plan.care_plan.payment_signature;}
 await store.save(state,previous);
}
