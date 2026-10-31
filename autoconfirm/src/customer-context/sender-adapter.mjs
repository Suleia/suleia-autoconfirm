import {compileCustomerCase} from './case-compiler.mjs';
import {evaluatePreCanaryGate,evaluateLiveCapabilityGate} from './release-gates.mjs';
import {hash} from '../customer-care/context.mjs';
import {isCustomerInteraction,messageTimestamp} from '../workflows/incident-discount-policy.mjs';

export function decorateConversationV3(legacy,input,{previous=null,env={},releaseReport=null,canaryCase=null,admission=null,authorizationRef=null}={}){
 if(env.CONVERSATION_V3_ENABLED!=='true')return {plan:legacy,care:null};
 const care=compileCustomerCase(input,previous);care.mode='SHADOW';
 const mode=env.CONVERSATION_INTELLIGENCE_V3_MODE||'SHADOW';
 if(mode==='SHADOW'||!evaluatePreCanaryGate(releaseReport).allowed)return {plan:legacy,care};
 const isLive=mode==='LIVE'&&!!authorizationRef;
 const oldCanary=mode==='CANARY'&&canaryCase===`${care.canonical_order_id}:${care.active_issue_id}`&&legacy?.eligible&&legacy.kind==='CLARIFY';
 if(!isLive&&!oldCanary)return {plan:legacy,care};
 care.mode=isLive?'LIVE':'CANARY';
 const block=reason=>({plan:{eligible:false,reason,customerCare:care},care});
 if(isLive&&!input.policy?.liveVerifiedContext)return block('V3_FRESH_VERIFIED_PROVIDER_CONTEXT_REQUIRED');
 if(care.next_best_action==='WAITING_CUSTOMER'&&['WAITING_CUSTOMER','ONE_ACTIVE_CLARIFICATION'].includes(care.reason))return block('V3_WAITING_CUSTOMER');
 if(legacy?.eligible&&legacy.kind==='SOLUTION')return {plan:legacy,care};
 const capability=care.customer_reply_action==='CLARIFY'?'CONTEXTUAL_CLARIFICATION':['STATUS_RESPONSE','ACKNOWLEDGE_REQUEST'].includes(care.customer_reply_action)?'STATUS_REPLY':null;
 if(!capability){
  if(isLive&&legacy?.kind==='CLARIFY'&&legacy.reason==='PAYMENT_OR_PRICE_NEEDS_CONFIRMATION')return block('V3_VERIFIED_PAYMENT_INFORMATION_REQUIRED');
  if(isLive&&legacy?.kind==='CLARIFY'&&care.next_best_action==='DELEGATE')return block('V3_DELEGATED_TO_EXISTING_OWNER');
  return {plan:legacy,care};
 }
 const released=capability==='CONTEXTUAL_CLARIFICATION'?env.CONVERSATION_V3_CLARIFICATION_ENABLED==='true':env.CONVERSATION_V3_STATUS_REPLY_ENABLED==='true';
 if(isLive&&input.policy.liveReplyOwnerBusy)return block('V3_EXISTING_OWNER_IN_FLIGHT');
 if(isLive&&capability==='CONTEXTUAL_CLARIFICATION'&&!['absent','rejected_goods'].includes(care.current_incident_type))return block('V3_EXISTING_SPECIALIST_CLARIFICATION_OWNER');
 if(!released)return block('V3_REPLY_CAPABILITY_NOT_RELEASED');
 if(care.operational_action!=='NONE')return block('V3_REPLY_OPERATIONAL_OWNER_REQUIRED');
 if(oldCanary&&(capability!=='CONTEXTUAL_CLARIFICATION'||care.missing_information?.length!==1))return block('V3_INITIAL_CANARY_REQUIRES_ONE_MISSING_FACT');
 if(capability==='CONTEXTUAL_CLARIFICATION'&&(!care.missing_information?.length||care.missing_information.length>2))return block('V3_ONLY_REQUIRED_MISSING_INFORMATION');
 if(capability==='STATUS_REPLY'&&!input.policy?.providerReadVerified)return block('V3_FRESH_PROVIDER_STATUS_REQUIRED');
 const age=(input.now??Date.now())-Date.parse(care.latest_customer_at);
 if(!Number.isFinite(age)||age<3600000||age>=24*3600000)return block('EXISTING_REPLY_WINDOW_REQUIRED');
 if(!care.proposed_response)return block('VERIFIED_RESPONSE_CONTENT_UNAVAILABLE');
 const latest=input.messages.filter(isCustomerInteraction).sort((a,b)=>messageTimestamp(a)-messageTimestamp(b)).at(-1);
 const plan={eligible:true,kind:'CLARIFY',reason:`CONVERSATION_V3_${capability}_${care.conversation_version}`,orderId:care.dropea_order_id,issueId:care.active_issue_id,conversationId:care.conversation_reference,messageAt:care.latest_customer_at,messageId:String(latest?.id||''),content:care.proposed_response,care_plan:care,care_capability:capability};
 plan.hash=hash([plan.orderId,plan.issueId,care.case_hash,plan.content]);
 if(isLive){
  const gate=evaluateLiveCapabilityGate(releaseReport,{capability,admission,caseKey:`${care.canonical_order_id}:${care.active_issue_id}`,conversationId:care.conversation_reference,inputHash:care.input_hash,authorizationRef});
  if(!gate.allowed)return {...block('V3_CAPABILITY_ADMISSION_REQUIRED'),capabilityCandidate:plan,gate};
  if(admission.stage==='CANARY'&&capability==='CONTEXTUAL_CLARIFICATION'&&care.missing_information.length!==1)return block('V3_INITIAL_CANARY_REQUIRES_ONE_MISSING_FACT');
  plan.care_admission=admission;
 }
 return {plan,care};
}
