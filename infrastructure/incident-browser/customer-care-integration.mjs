import {decorateClarification} from '../../autoconfirm/src/customer-care/clarification-adapter.mjs';
import {createCustomerCareStore} from '../../autoconfirm/src/customer-care/store.mjs';
import {careFlags} from '../../autoconfirm/src/customer-care/policy.mjs';
import {hash} from '../../autoconfirm/src/customer-care/context.mjs';
import {decorateConversationV3} from '../../autoconfirm/src/customer-context/sender-adapter.mjs';
import {carePolicyFor} from '../../autoconfirm/src/customer-care/runtime.mjs';
import {liveCarePolicy,stableCarePolicy} from '../../autoconfirm/src/customer-context/live-policy.mjs';
import {compileCustomerCase,readCompiledIntent} from '../../autoconfirm/src/customer-context/case-compiler.mjs';
import {admitConversationV3} from './conversation-v3-release.mjs';

export function customerCareEnvironment(control){
 const care=control?.customerCare||{};
 return {CUSTOMER_CARE_ENABLED:care.enabled===true?'true':'false',CUSTOMER_CARE_CONTEXT_ENABLED:care.context===true?'true':'false',CUSTOMER_CARE_CLARIFICATION_ENABLED:care.clarification===true?'true':'false',CUSTOMER_CARE_STATUS_REPLY_ENABLED:care.statusReply===true?'true':'false',CUSTOMER_CARE_MODE:care.mode||'SHADOW',CUSTOMER_CARE_AI_INTERPRETER_ENABLED:'false'};
}

// A pure preview only decides whether the existing worker needs an exact
// association read. It never persists, releases a plan or authorizes a write.
export function needsConversationV3Read(input){
 const care=compileCustomerCase({...input,policy:carePolicyFor(input),binding:{verified:true,orderId:String(input.order.orderId),issueId:String(input.incident.incidenceId),conversationId:input.incident.chatbyUserNs}});
 return care.has_current_reply&&(care.customer_reply_action==='CLARIFY'||care.operational_action==='RETRY_DELIVERY'||care.pending_customer_questions?.length>0);
}
export function verifyConversationV3Dispatch(plan,input,memory){
 const fail=code=>{throw Object.assign(Error(code),{notSent:true});};
 const care=plan.care_plan;if(care?.version!=='CONVERSATION_V3'||care.reply_owner!=='vps_delivery_reply')fail('V3_REPLY_OWNER_CONFLICT');
 if(input.policy?.liveVerifiedContext!==true||input.binding?.verified!==true)fail('V3_FRESH_DISPATCH_READ_REQUIRED');
 if(input.policy.liveReplyOwnerBusy)fail('V3_EXISTING_OWNER_IN_FLIGHT');
 const age=(input.now??Date.now())-Date.parse(care.latest_customer_at);
 if(!Number.isFinite(age)||age<3600000||age>=24*3600000)fail('V3_CUSTOMER_REPLY_WINDOW_CHANGED');
 if(hash(stableCarePolicy(input.policy))!==hash(stableCarePolicy(care.policy)))fail('STALE_PLAN');
 const actual=readCompiledIntent(care,input);if(!actual||actual.status==='NOT_VERIFIABLE')fail('STALE_PLAN');
 if(memory?.dropea_order_id!==plan.orderId||memory?.active_issue_id!==plan.issueId||memory?.conversation_reference!==plan.conversationId)fail('V3_MEMORY_DISPATCH_IDENTITY_CHANGED');
 const messageHash=hash(plan.content);
 if((memory.clarifications||[]).some(q=>!q.answered_at&&['ATTEMPTING','PROVIDER_ACCEPTED','DELIVERY_UNVERIFIED'].includes(q.status)&&q.message_hash!==messageHash))fail('V3_OTHER_CLARIFICATION_ACTIVE');
 if(memory.pending_provider_response&&memory.pending_response_hash!==messageHash)fail('V3_OTHER_INFORMATION_RESPONSE_PENDING');
 return {expiresAt:Math.min(Date.parse(input.freshProof.orderReadAt),Date.parse(input.freshProof.conversationReadAt))+60000};
}

// Uses only the existing worker's inputs after its fresh association and prior
// return gates. This function cannot send text or call a provider action.
export async function prepareCustomerCare(legacy,input,{control,store=createCustomerCareStore(),v3Store=createCustomerCareStore({prefix:'conversation_v3'}),now=Date.now(),releaseDeps}={}){
 if(control?.conversationV3?.enabled===true){
  const v3=control.conversationV3,storage=v3Store;
  try{
   const previous=await storage.load({canonical_order_id:String(input.order.orderId),active_issue_id:String(input.incident.incidenceId)});
   const policy=input.policy||(v3.mode==='LIVE'&&v3.authorizationRef?liveCarePolicy(input,{now,supportReceipt:input.supportReceipt,paymentMethods:v3.paymentMethods||[],authorizationRef:v3.authorizationRef}):carePolicyFor(input));
   const bound={...input,policy,now,binding:{verified:true,orderId:String(input.order.orderId),issueId:String(input.incident.incidenceId),conversationId:input.incident.chatbyUserNs}};
   const options={previous:previous?.value,env:{CONVERSATION_V3_ENABLED:'true',CONVERSATION_INTELLIGENCE_V3_MODE:v3.mode||'SHADOW',CONVERSATION_V3_CLARIFICATION_ENABLED:String(v3.clarification===true),CONVERSATION_V3_STATUS_REPLY_ENABLED:String(v3.statusReply===true)},releaseReport:v3.releaseReport||null,canaryCase:v3.canaryCase||null,authorizationRef:v3.authorizationRef||null};
   let result=decorateConversationV3(legacy,bound,options);
   if(result.capabilityCandidate){const admission=await admitConversationV3(result.capabilityCandidate,v3,releaseDeps);if(admission)result=decorateConversationV3(legacy,bound,{...options,admission});}
   if(result.care)await storage.save(result.care,previous);return result;
  }catch{
   const selected=(v3.mode==='LIVE'&&v3.authorizationRef||v3.mode==='CANARY'&&v3.canaryCase===`${input.order.orderId}:${input.incident.incidenceId}`)&&legacy?.kind==='CLARIFY';
   return {plan:selected?{eligible:false,reason:'V3_MEMORY_UNAVAILABLE'}:legacy,care:null,error:'V3_OBSERVATION_UNAVAILABLE'};
  }
 }
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

export async function recordCustomerCareReceipt(plan,result,{store=null}={}){
 if(!plan?.care_plan)return;
 store||=createCustomerCareStore({prefix:plan.care_plan.version==='CONVERSATION_V3'?'conversation_v3':'customer_care'});
 const identity={canonical_order_id:plan.orderId,active_issue_id:plan.issueId};
 const previous=await store.load(identity);if(!previous)throw Error('CUSTOMER_CARE_STATE_MISSING');
 const state=structuredClone(previous.value);
 if(state.conversation_reference!==plan.conversationId)throw Error('CUSTOMER_CARE_RECEIPT_IDENTITY_CHANGED');
 const mid=result.raw?.messageId||null;
 const messageHash=hash(plan.content),status=['sent','already_seen'].includes(result.status)?'PROVIDER_ACCEPTED':result.status==='aborted'?'ABORTED':'DELIVERY_UNVERIFIED';
 if(plan.care_plan.response_type!=='CLARIFICATION'){
  state.pending_provider_response=status==='DELIVERY_UNVERIFIED';state.pending_response_hash=state.pending_provider_response?messageHash:null;state.updated_at=new Date().toISOString();
  if(status==='PROVIDER_ACCEPTED'){
   state.responded_conversation_version=plan.care_plan.conversation_version;state.last_response_type=plan.care_plan.response_type;
   if(plan.care_plan.response_type==='ACKNOWLEDGE_REQUEST')state.acknowledged_action_hash=plan.care_plan.ack_action_hash;
   if(plan.care_plan.response_type==='PAYMENT_INFORMATION'){state.payment_information_sent=true;state.payment_information_signature=plan.care_plan.payment_signature;}
  }
  state.support_followup_required=plan.care_plan.product_context?.missingTopics||[];
  state.status=state.pending_provider_response||state.support_followup_required.length?'HUMAN_REVIEW':'OBSERVING';state.waiting_for_customer=false;
  state.timeline=[...state.timeline,{kind:'INFORMATION_RESPONSE',source:result.status==='already_seen'?'EXISTING_SENDER':'V3_EXISTING_SENDER',at:state.updated_at,message_hash:messageHash,provider_message_id:mid,status,
   response_type:plan.care_plan.response_type,
   readback_verified:result.raw?.readbackVerified===true&&result.raw?.providerReceipt===true,
   answered_fact_ids:result.raw?.readbackVerified===true&&result.raw?.providerReceipt===true?plan.care_plan.response_question_fact_ids||[]:[]}].slice(-100);
  await store.save(state,previous);return;
 }
 const question={clarification_type:plan.care_plan.missing_slots.join('+')||plan.care_capability,missing_slots:plan.care_plan.missing_slots,message_hash:messageHash,sent_at:result.sentAt||result.attemptedAt,provider_message_id:mid,answered_at:null,answer_hash:null,status,source:result.status==='already_seen'?'EXISTING_SENDER':'CUSTOMER_CARE_EXISTING_SENDER',based_on_conversation_version:plan.care_plan.conversation_version};
 // Replace only this question's in-flight projection; never clear old entries.
 state.clarifications=[...state.clarifications.filter(c=>c.message_hash!==messageHash||c.based_on_conversation_version!==question.based_on_conversation_version),question];
 state.last_outbound_message_hash=messageHash;state.last_outbound_question_type=question.clarification_type;state.last_outbound_question_at=question.sent_at;
 state.status=status==='ABORTED'?'OBSERVING':'WAITING_CUSTOMER';state.waiting_for_customer=status!=='ABORTED';state.updated_at=new Date().toISOString();
 if(status==='PROVIDER_ACCEPTED'&&plan.care_plan.response_type==='PAYMENT_INFORMATION'){state.payment_information_sent=true;state.payment_information_signature=plan.care_plan.payment_signature;}
 await store.save(state,previous);
}
