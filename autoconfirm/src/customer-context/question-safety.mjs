import {contextualQuestion} from './question-context.mjs';
import {fold} from '../customer-care/context.mjs';
import {isCustomerInteraction,messageTimestamp,extractWamid} from '../workflows/incident-discount-policy.mjs';
import {addressMessageText} from '../workflows/address-response-policy.mjs';
import {deduplicatePayloadText} from './message-cluster.mjs';

export function frustratedReply(text){
  return /^(?:pues )?(?:es igual|me da igual|da igual|dejalo|dejadlo|olvidalo|olvidadlo|no me escrib(?:as|ais|an) mas|no me mand(?:es|eis|en) mas mensajes)[.! ]*$/.test(fold(deduplicatePayloadText(text)));
}
export function questionFamily(plan,content=plan.content){
  const slots=plan.care_plan?.missing_information||plan.care_plan?.missing_slots||[];
  if(slots.some(s=>/DATE|WINDOW|TIME_FROM|TIME_TO|AVAILABILITY/.test(s)))return 'DELIVERY_SCHEDULE';
  const type=contextualQuestion({payload:{text:content}});
  if(['DATE','TIME_WINDOW','DATE_AND_WINDOW','WANTS_ORDER_AND_SCHEDULE'].includes(type))return 'DELIVERY_SCHEDULE';
  if(['WANTS_ORDER','CONFIRM_ORDER'].includes(type)||slots.includes('WANTS_ORDER'))return 'ORDER_INTENT';
  return 'CUSTOMER_CONTEXT';
}
export function clarificationHistoryGuard(plan,content,messages,deliveries=[],{currentKey=null}={}){
  const created=Date.parse(plan.orderCreatedAt||plan.care_plan?.order_created_at);
  if(!Number.isFinite(created))return {allowed:false,reason:'QUESTION_ORDER_BOUNDARY_REQUIRED'};
  const family=questionFamily(plan,content);
  const incoming=messages.filter(m=>String(m.user_ns)===plan.conversationId&&isCustomerInteraction(m)&&messageTimestamp(m)>=created).sort((a,b)=>messageTimestamp(a)-messageTimestamp(b));
  if(frustratedReply(addressMessageText(incoming.at(-1)||{})))return {allowed:false,reason:'CUSTOMER_FRUSTRATION_REQUIRES_HUMAN_REVIEW'};
  const prior=deliveries.find(r=>String(r.order_id)===String(plan.orderId)&&r.template_name!==currentKey&&/^incident_delivery_clarify_v[12](?::|$)/.test(r.template_name||'')&&!(r.status==='aborted'&&r.raw?.notSent===true));
  // Any earlier automated clarification is a conservative handoff, including
  // another issue/reason or an unknown outcome. Never reset its reservation.
  if(prior)return {allowed:false,reason:'ORDER_ALREADY_HAS_AUTOMATED_CLARIFICATION'};
  const own=deliveries.find(r=>r.template_name===currentKey&&String(r.order_id)===String(plan.orderId));
  if(own&&['sent','already_seen'].includes(own.status))return {allowed:false,reason:'ORDER_ALREADY_HAS_AUTOMATED_CLARIFICATION'};
  if(own)return {allowed:true,family,reconcileOnly:true};
  const seen=messages.some(m=>{
    if(String(m.user_ns)!==plan.conversationId||isCustomerInteraction(m)||!extractWamid(m)||messageTimestamp(m)<created||m.payload?.name)return false;
    const text=addressMessageText(m);
    return /[?¿]|\b(?:indiquenos|indique|confirme|confirmenos|diganos)\b/.test(fold(text))&&questionFamily({},text)===family;
  });
  return seen?{allowed:false,reason:'CLARIFICATION_TOPIC_ALREADY_ASKED'}:{allowed:true,family};
}
