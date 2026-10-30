import {hash,OWNERS} from './context.mjs';

export function careFlags(env={}){
 const on=k=>env[k]==='true';
 return {enabled:on('CUSTOMER_CARE_ENABLED'),context:on('CUSTOMER_CARE_CONTEXT_ENABLED'),clarification:on('CUSTOMER_CARE_CLARIFICATION_ENABLED'),statusReply:on('CUSTOMER_CARE_STATUS_REPLY_ENABLED'),ai:false,
  mode:['SHADOW','CANARY','LIVE'].includes(env.CUSTOMER_CARE_MODE)?env.CUSTOMER_CARE_MODE:'SHADOW'};
}
export function requiredMissingSlots(state,policy={}){
 if(state.wants_return||state.cancel_intent)return [];
 if(state.address_change_requested)return ['street','number','postal_code','city'].filter(k=>!(k==='postal_code'?state.postal_code||state.address?.[k]:state.address?.[k])).map(k=>k.toUpperCase());
 if(state.wants_order!==true)return ['WANTS_ORDER'];
 if(policy.ownerProvidesDefaultSchedule===true&&!state.delivery_date&&!state.delivery_window&&!state.time_from&&!state.time_to&&!state.expired_delivery_date)return [];
 const missing=[];
 if(policy.requireDeliveryDate===true&&!state.delivery_date&&!(policy.ownerProvidesDefaultDate===true&&(state.delivery_window||state.time_from||state.time_to)&&!state.expired_delivery_date))missing.push('DELIVERY_DATE');
 if(policy.requireDeliveryWindow===true&&!state.delivery_window&&!state.time_from&&!state.time_to)missing.push('TIME_WINDOW');
 return missing;
}
const deliveryOwner='REDELIVERY';
export function routeCustomerCase(state,policy={}){
 const result=(action,capability,reason,extra={})=>{
  const owner=capability?OWNERS[capability]:'HUMAN';
  const plan={next_best_action:action,capability:capability||null,owner,reason,based_on_conversation_version:state.conversation_version,based_on_input_hash:state.input_hash,based_on_context_hash:state.context_hash,missing_slots:[],...extra};
  plan.plan_hash=hash(plan);
  return plan;
 };
 if(!state.input_hash)return result('HUMAN_REVIEW',null,state.reason||'UNVERIFIED_CONTEXT');
 const irreversible=policy.irreversibleAction||['RETURN_REQUESTED','CANCELLATION_APPLIED'].includes(state.last_verified_action?.action)&&state.last_verified_action.action;
 if(irreversible){
  if(state.wants_order)return result('HUMAN_REVIEW',null,'IRREVERSIBLE_ACTION_ALREADY_EXECUTED');
  return result('WAITING_PROVIDER',null,'IRREVERSIBLE_ACTION_AWAITING_OUTCOME');
 }
 if(['DELIVERED','RETURNED','CANCELLED'].includes(state.current_order_state))return result('WAITING_PROVIDER',null,'TERMINAL_OUTCOME_VERIFY_AND_CLOSE',{outcome:state.current_order_state,case_status:'CLOSED'});
 if(state.unresolved_interpretation?.length)return result('HUMAN_REVIEW',null,state.unresolved_interpretation[0]);
 if(!state.has_current_reply)return result('WAITING_CUSTOMER',null,'NO_CURRENT_CUSTOMER_REPLY');
 // These routes are proposals to existing owners. They never authorize a new
 // writer, bypass a capability gate, shorten settling or synthesize acceptance.
 if(state.wants_return||state.cancel_intent)return result('DELEGATE',state.current_order_state==='PENDING_CONFIRMATION'?'AUTO_CANCEL':'RETURN','CUSTOMER_EXPLICITLY_DECLINED');
 if(state.discount_response==='ACCEPTED')return result('DELEGATE','DISCOUNT_ACCEPT','CURRENT_OFFER_ACCEPTED');
 if(state.payment_constraint)return result('HUMAN_REVIEW',null,'CUSTOMER_PAYMENT_CONSTRAINT_REQUIRES_REVIEW');
 if(state.address_change_requested||state.agency_requested){return result('DELEGATE',state.address_change_requested?'ADDRESS':'AGENCY','EXISTING_SPECIALIST_OWNER',{missing_slots:requiredMissingSlots(state,policy)});}
 if(state.wants_order===true&&['PENDING','PENDING_CONFIRMATION','PENDING_DROPSHIPPER'].includes(state.current_order_state))return result('DELEGATE','CONFIRM_ORDER','CONFIRM_INTENT_EXISTING_OWNER');
 const unanswered=state.clarifications.filter(c=>!c.answered_at&&['ATTEMPTING','PROVIDER_ACCEPTED','DELIVERY_UNVERIFIED'].includes(c.status));
 if(unanswered.length)return result('WAITING_CUSTOMER',null,'ONE_ACTIVE_CLARIFICATION',{active_question_hash:unanswered.at(-1).message_hash});
 const intents=state.latest_customer_intents;
 if(intents.some(i=>['REPORTS_DAMAGE','REPORTS_MISSING_ITEM','REPORTS_WRONG_PRODUCT'].includes(i)))return result('HUMAN_REVIEW',null,'PRODUCT_INCIDENT_REQUIRES_SPECIALIST');
 if(intents.includes('ASKS_PAYMENT')){
  if(!policy.paymentVerified||state.amount_due===null||!state.allowed_payment_methods.length)return result('HUMAN_REVIEW',null,'VERIFIED_PAYMENT_INFORMATION_REQUIRED');
  return result('RESPOND','STATUS_REPLY','PAYMENT_INFORMATION',{response_type:'PAYMENT_INFORMATION',payment_signature:hash([state.amount_due,state.allowed_payment_methods]),missing_slots:[]});
 }
 if(intents.some(i=>['ASKS_STATUS','ASKS_DELIVERY_DATE'].includes(i))&&!state.reports_no_delivery_attempt&&state.wants_order!==true){
  if(!policy.providerReadVerified||!policy.providerReadAt||Date.parse(state.updated_at)-Date.parse(policy.providerReadAt)>60000||Date.parse(policy.providerReadAt)>Date.parse(state.updated_at))return result('WAITING_PROVIDER',null,'FRESH_PROVIDER_STATUS_REQUIRED');
  return result('RESPOND','STATUS_REPLY','VERIFIED_ORDER_STATUS',{response_type:'ORDER_STATUS'});
 }
 if(intents.some(i=>['ASKS_PRODUCT','ASKS_USAGE'].includes(i))){
  const faq=policy.verifiedFaq;
  if(!faq?.text||!faq?.source||faq.verified!==true)return result('HUMAN_REVIEW',null,'VERIFIED_PRODUCT_SOURCE_REQUIRED');
  return result('RESPOND','STATUS_REPLY','VERIFIED_FAQ',{response_type:'FAQ'});
 }
 const missing=requiredMissingSlots(state,policy);
 if(!missing.length&&state.wants_order===true){
  if(state.last_verified_action?.status==='VERIFIED'&&Date.parse(state.last_verified_action.at)>=Date.parse(state.latest_intent_at))return result('WAITING_PROVIDER',deliveryOwner,'EXISTING_ACTION_AWAITING_LOGISTICS');
  return result('DELEGATE',deliveryOwner,'CURRENT_DELIVERY_FACTS_AVAILABLE');
 }
 if(intents.every(i=>['GREETING','THANKS','IRRELEVANT'].includes(i)))return result('WAITING_CUSTOMER',null,'COURTESY_PRESERVES_KNOWN_FACTS');
 if(state.confidence<0.65||intents.includes('AMBIGUOUS'))return result('HUMAN_REVIEW',null,'AMBIGUOUS_CUSTOMER_CONTEXT');
 return result('RESPOND','CONTEXTUAL_CLARIFICATION','ONLY_REQUIRED_MISSING_SLOTS',{response_type:'CLARIFICATION',missing_slots:missing});
}

export function responseForPlan(state,plan,policy={}){
 if(plan.next_best_action!=='RESPOND')return null;
 if(plan.response_type==='PAYMENT_INFORMATION'){
  const signature=hash([state.amount_due,state.allowed_payment_methods]);
  if(state.payment_information_sent&&state.payment_information_signature===signature&&!state.latest_customer_intents.includes('ASKS_PAYMENT'))return null;
  const amount=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(state.amount_due);
  const methods=state.allowed_payment_methods.map(m=>({CASH:'en efectivo',CARD:'con tarjeta'})[m]).join(' o ');
  return `El importe pendiente es de ${amount} y podrá abonarlo al recibirlo ${methods}.`;
 }
 if(plan.response_type==='FAQ')return policy.verifiedFaq?.verified===true?policy.verifiedFaq.text:null;
 if(plan.response_type==='ORDER_STATUS'){
  const status={PREPARED:'El pedido figura preparado.',IN_TRANSIT:'El pedido está en tránsito.',ERROR:'El pedido tiene una incidencia de entrega.',INCIDENCE:'El pedido tiene una incidencia de entrega.',DELIVERED:'El pedido figura entregado.',RETURNED:'El pedido figura devuelto.'}[state.current_order_state];
  return status?status+(state.last_verified_action?.status==='VERIFIED'&&state.last_verified_action.action==='REDELIVERY'?' Hemos solicitado una nueva entrega.':''):null;
 }
 const missing=plan.missing_slots;
 if(missing.length===1){
  return {WANTS_ORDER:'¿Quiere que solicitemos una nueva entrega de su pedido?',DELIVERY_DATE:'Perfecto. ¿Qué día le viene bien recibir el pedido?',TIME_WINDOW:'Perfecto. ¿Prefiere recibirlo por la mañana o por la tarde?',POSTAL_CODE:'Para completar la dirección, ¿cuál es el código postal?',STREET:'¿Cuál es la calle de entrega?',NUMBER:'¿Cuál es el número de la calle?',CITY:'¿Cuál es la localidad de entrega?'}[missing[0]]||null;
 }
 if(missing.length===2&&missing.includes('DELIVERY_DATE')&&missing.includes('TIME_WINDOW'))return 'Perfecto. ¿Qué día y en qué franja horaria le viene bien recibir el pedido?';
 return null; // Never broaden a narrow missing-slot question into a full form.
}

export function applyCarePlan(state,plan){
 const next={...state,...plan,status:({RESPOND:'READY',DELEGATE:'DELEGATED',EXECUTE_AUTHORIZED_ACTION:'READY',WAITING_CUSTOMER:'WAITING_CUSTOMER',WAITING_PROVIDER:'WAITING_PROVIDER',HUMAN_REVIEW:'HUMAN_REVIEW'})[plan.next_best_action]||'HUMAN_REVIEW'};
 next.waiting_for_customer=plan.next_best_action==='WAITING_CUSTOMER';next.waiting_for_provider=plan.next_best_action==='WAITING_PROVIDER';
 if(plan.case_status)next.status=plan.case_status;
 next.resolution_plan={goal:state.wants_return?'RETURN':state.wants_order?'DELIVERY':'CUSTOMER_CARE',known_facts:Object.keys(state.fact_evidence||{}),missing_facts:plan.missing_slots,steps:[{action:'INTERPRET',owner:OWNERS.INTERPRET_CUSTOMER,status:'COMPLETE'},{action:plan.capability||plan.next_best_action,owner:plan.owner,status:plan.next_best_action==='DELEGATE'?'DELEGATED':next.status,dependencies:plan.missing_slots},{action:'VERIFY_PROVIDER_OUTCOME',owner:plan.owner,status:'WAITING'}],status:next.status};
 next.timeline=[...(state.timeline||[]),{kind:'DECISION',at:state.updated_at,action:plan.next_best_action,owner:plan.owner,reason:plan.reason,plan_hash:plan.plan_hash}].slice(-100);
 return next;
}

export function assertFreshPlan(plan,current){
 if(plan.based_on_conversation_version!==current.conversation_version||plan.based_on_input_hash!==current.input_hash||plan.based_on_context_hash!==current.context_hash)throw Object.assign(Error('STALE_PLAN'),{code:'STALE_PLAN'});
 if(plan.plan_hash!==current.plan_hash)throw Object.assign(Error('POLICY_PLAN_CHANGED'),{code:'STALE_PLAN'});
}
