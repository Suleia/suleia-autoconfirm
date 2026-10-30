import {careFlags,responseForPlan,assertFreshPlan} from './policy.mjs';
import {interpretCustomerCase} from './runtime.mjs';
import {hash} from './context.mjs';
import {isCustomerInteraction,messageTimestamp} from '../workflows/incident-discount-policy.mjs';

// Called only by the existing VPS delivery-reply sender. This adapter is a
// message-plan decorator; it cannot call a provider or an operational writer.
// A DELEGATE record never becomes a financial/logistics execution instruction.
export function decorateClarification(legacy,input,{previous=null,env={},policy=input.policy,canaryCase=null}={}){
 const flags=careFlags(env);
 if(!flags.enabled||!flags.context)return {plan:legacy,care:null};
 const care=interpretCustomerCase({...input,policy},previous);
 care.mode=flags.mode;
 if(flags.mode==='SHADOW')return {plan:legacy,care};
 // Existing solution/ack actions remain byte-for-byte the legacy owner's plan.
 if(legacy?.eligible&&legacy.kind!=='CLARIFY')return {plan:legacy,care};
 const caseIdentity=`${care.canonical_order_id}:${care.active_issue_id}`;
 if(flags.mode==='CANARY'&&canaryCase!==caseIdentity)return {plan:legacy,care};
 if(!flags.clarification)return {plan:legacy,care};
 const block=reason=>({plan:{eligible:false,reason,customerCare:care},care});
 if(care.next_best_action!=='RESPOND')return block(care.next_best_action==='DELEGATE'?'CUSTOMER_CARE_DELEGATED_TO_EXISTING_OWNER':care.reason);
 if(care.capability!=='CONTEXTUAL_CLARIFICATION'&&!(care.capability==='STATUS_REPLY'&&flags.statusReply))return block('CUSTOMER_CARE_CAPABILITY_NOT_RELEASED');
 const now=input.now??Date.now();
 // Preserve the existing one-hour settling and 24-hour reply window.
 if(!care.latest_customer_at||now-Date.parse(care.latest_customer_at)<3600000)return block('REPLY_SETTLING_WINDOW');
 if(now-Date.parse(care.latest_customer_at)>=24*3600000)return block('CUSTOMER_REPLY_WINDOW_EXPIRED');
 const text=responseForPlan(care,care,policy);
 if(!text)return block('VERIFIED_RESPONSE_CONTENT_UNAVAILABLE');
 const latest=input.messages.filter(isCustomerInteraction).sort((a,b)=>messageTimestamp(a)-messageTimestamp(b)).at(-1);
 const plan={eligible:true,kind:'CLARIFY',reason:`CUSTOMER_CARE_V1_${care.conversation_version}`,orderId:care.dropea_order_id,issueId:care.active_issue_id,conversationId:care.conversation_reference,messageAt:care.latest_customer_at,messageId:String(latest?.id||''),content:text,care_plan:care,care_capability:care.capability};
 return {plan:{...plan,hash:hash([plan.orderId,plan.issueId,plan.conversationId,plan.content,care.plan_hash])},care};
}

export function revalidateCarePlan(plan,current){
 if(!plan?.care_plan)return;
 if(String(plan.orderId)!==String(current.dropea_order_id)||String(plan.issueId)!==String(current.active_issue_id)||plan.conversationId!==current.conversation_reference)throw Error('CUSTOMER_CARE_IDENTITY_CHANGED');
 assertFreshPlan(plan.care_plan,current);
}
