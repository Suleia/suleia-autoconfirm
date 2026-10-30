import {compileCustomerCase} from './case-compiler.mjs';
import {evaluateConversationRelease} from './release-gates.mjs';
import {hash} from '../customer-care/context.mjs';
import {isCustomerInteraction,messageTimestamp} from '../workflows/incident-discount-policy.mjs';
export function decorateConversationV3(legacy,input,{previous=null,env={},releaseReport=null,canaryCase=null}={}){
  if(env.CONVERSATION_V3_ENABLED!=='true')return {plan:legacy,care:null};
  const care=compileCustomerCase(input,previous);care.mode='SHADOW';
  const mode=env.CONVERSATION_INTELLIGENCE_V3_MODE||'SHADOW';
  if(mode==='SHADOW'||!evaluateConversationRelease(releaseReport).allowed)return {plan:legacy,care};
  // Initial promotion is always one explicit natural case, even if a caller
  // mistakenly requests global LIVE. Operational solution plans are untouched.
  if(mode!=='CANARY'||canaryCase!==`${care.canonical_order_id}:${care.active_issue_id}`||legacy?.eligible&&legacy.kind!=='CLARIFY')return {plan:legacy,care};
  if(env.CONVERSATION_V3_CLARIFICATION_ENABLED!=='true'&&env.CONVERSATION_V3_STATUS_REPLY_ENABLED!=='true')return {plan:legacy,care};
  care.mode='CANARY';
  const block=reason=>({plan:{eligible:false,reason,customerCare:care},care});
  if(care.next_best_action!=='RESPOND'&&care.customer_reply_action!=='ACKNOWLEDGE_REQUEST')return block(care.reason);
  const released=care.customer_reply_action==='CLARIFY'?env.CONVERSATION_V3_CLARIFICATION_ENABLED==='true':['STATUS_RESPONSE','ACKNOWLEDGE_REQUEST'].includes(care.customer_reply_action)&&env.CONVERSATION_V3_STATUS_REPLY_ENABLED==='true';
  if(!released)return block('V3_REPLY_CAPABILITY_NOT_RELEASED');
  const age=(input.now??Date.now())-Date.parse(care.latest_customer_at);
  if(!Number.isFinite(age)||age<3600000||age>=24*3600000)return block('EXISTING_REPLY_WINDOW_REQUIRED');
  if(!care.proposed_response)return block('VERIFIED_RESPONSE_CONTENT_UNAVAILABLE');
  const latest=input.messages.filter(isCustomerInteraction).sort((a,b)=>messageTimestamp(a)-messageTimestamp(b)).at(-1);
  const plan={eligible:true,kind:'CLARIFY',reason:`CONVERSATION_V3_${care.conversation_version}`,orderId:care.dropea_order_id,issueId:care.active_issue_id,conversationId:care.conversation_reference,messageAt:care.latest_customer_at,messageId:String(latest?.id||''),content:care.proposed_response,care_plan:care,care_capability:care.capability};
  plan.hash=hash([plan.orderId,plan.issueId,care.case_hash,plan.content]);return {plan,care};
}
