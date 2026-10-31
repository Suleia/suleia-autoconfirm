import {responseForPlan} from '../customer-care/policy.mjs';
import {hash} from '../customer-care/context.mjs';
export function questionAnswerBundle(context){
  if(context.customer_reply_action!=='STATUS_RESPONSE')return null;
  const pending=context.pending_customer_questions||[],types=new Set(pending.map(q=>q.type));
  const parts=[],answered=[];
  const add=(text,topics)=>{if(text){parts.push(text);answered.push(...pending.filter(q=>topics.includes(q.type)).map(q=>q.fact_id));}};
  const faq=context.product_context||context.policy.verifiedFaq;
  if(types.has('ASKS_PRODUCT')||types.has('ASKS_USAGE')){
    if(!faq?.verified||!faq.source||faq.orderId&&faq.orderId!==context.dropea_order_id)return {text:null,answeredFactIds:[]};
    add(faq.text,faq.complete===false?[]:['ASKS_PRODUCT','ASKS_USAGE']);
  }
  if(types.has('ASKS_PAYMENT')){
    if(!context.policy.paymentVerified||!Number.isFinite(context.amount_due)||!context.allowed_payment_methods.length)return {text:null,answeredFactIds:[]};
    add(responseForPlan(context,{next_best_action:'RESPOND',response_type:'PAYMENT_INFORMATION'},context.policy),['ASKS_PAYMENT']);
  }
  if(types.has('ASKS_STATUS')||types.has('ASKS_DELIVERY_DATE')){
    if(!context.policy.providerReadVerified)return {text:null,answeredFactIds:[]};
    add(responseForPlan(context,{next_best_action:'RESPOND',response_type:'ORDER_STATUS'},context.policy),['ASKS_STATUS','ASKS_DELIVERY_DATE']);
  }
  if(!parts.length)return null;
  const text=parts.join(' '),unique=[...new Set(answered)];
  if((context.timeline||[]).some(e=>e.kind==='INFORMATION_RESPONSE'&&e.status==='PROVIDER_ACCEPTED'&&e.readback_verified&&e.message_hash===hash(text)&&unique.every(id=>(e.answered_fact_ids||[]).includes(id))))return {text:null,answeredFactIds:[]};
  return {text,answeredFactIds:unique};
}
export function composeSafeResponse(context){
  const reply=context.customer_reply_action;
  if(['NONE','WAITING_CUSTOMER','HUMAN_REVIEW'].includes(reply))return null;
  const answers=questionAnswerBundle(context);
  if(answers)return answers.text;
  if(context.response_type==='FAQ'){
    const faq=context.product_context||context.policy.verifiedFaq;
    if(!faq?.verified||!faq.source||faq.orderId&&faq.orderId!==context.dropea_order_id)return null;
    const parts=[faq.text];
    if(context.latest_customer_intents.includes('ASKS_PAYMENT')&&context.policy.paymentVerified&&Number.isFinite(context.amount_due)&&context.allowed_payment_methods.length)
      parts.push(responseForPlan(context,{next_best_action:'RESPOND',response_type:'PAYMENT_INFORMATION'},context.policy));
    if(context.delivery_date&&context.current_facts.DELIVERY_AVAILABILITY?.value_json)
      parts.push(`Consta su preferencia para el ${context.delivery_date}: ${context.current_facts.DELIVERY_AVAILABILITY.value_json}. La fecha sigue pendiente de confirmación por el transportista.`);
    return parts.filter(Boolean).join(' ');
  }
  if(reply==='CLARIFY'){
    if(context.missing_information?.length===1){
      if(context.missing_information[0]==='TIME_FROM')return '¿A partir de qué hora le viene bien recibir el pedido?';
      if(context.missing_information[0]==='TIME_TO')return '¿Antes de qué hora necesita recibir el pedido?';
    }
    return responseForPlan(context,{...context,next_best_action:'RESPOND',response_type:'CLARIFICATION',missing_slots:context.missing_information},context.policy);
  }
  if(reply==='ACKNOWLEDGE_REQUEST'){
    const action=context.last_verified_action;
    if(action?.status!=='VERIFIED'||!['RETRY_DELIVERY','REDELIVERY'].includes(action.action)||!context.policy.providerReadVerified)return null;
    return 'Hemos solicitado una nueva entrega de su pedido. La entrega está pendiente de la empresa de transporte.';
  }
  return responseForPlan(context,context,context.policy);
}
