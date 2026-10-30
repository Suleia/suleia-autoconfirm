import {responseForPlan} from '../customer-care/policy.mjs';
export function composeSafeResponse(context){
  const reply=context.customer_reply_action;
  if(['NONE','WAITING_CUSTOMER','HUMAN_REVIEW'].includes(reply))return null;
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
