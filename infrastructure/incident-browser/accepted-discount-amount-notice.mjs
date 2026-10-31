import {sendDeliveryReplyOnce} from './delivery-reply-executor.mjs';
import {extractWamid,isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';

export function acceptedDiscountAmountContent(plan){
 if(plan?.eligible!==true||!Number.isSafeInteger(plan.originalCents)||!Number.isSafeInteger(plan.finalCents)
  ||plan.originalCents<=500||plan.finalCents!==plan.originalCents-500)return null;
 const final=(plan.finalCents/100).toFixed(2).replace('.',',');
 return `Hola, con el descuento de 5 €, el importe final de su pedido es de ${final} €. Un saludo.`;
}

export function existingDiscountAmountNotice(messages,plan){
 if(!acceptedDiscountAmountContent(plan))return null;
 const amount=(plan.finalCents/100).toFixed(2).replace('.', '[.,]');
 const final=new RegExp(`\\b(?:importe final|precio final|total(?: final)?(?: a pagar| a cobrar)?)[^.!?\\n]{0,100}?\\b${amount}\\s*(?:€|euros?)`,'i');
 return messages.find(m=>!isCustomerInteraction(m)&&String(m.user_ns)===plan.conversationId&&extractWamid(m)
  &&messageTimestamp(m)>=Date.parse(plan.acceptedAt)
  &&/descuento\s+(?:de\s+)?5\s*(?:€|euros?)/i.test(addressMessageText(m))
  &&!/(?:no|sin)\s+(?:hay|tiene|se aplica|es|son|descuento)/i.test(addressMessageText(m))
  &&final.test(addressMessageText(m)))||null;
}

export async function sendAcceptedDiscountAmountOnce(plan,deps){
 const content=acceptedDiscountAmountContent(plan),now=deps.now?.()||Date.now();
 if(!content)return {status:'BLOCKED',reason:'EXACT_FIVE_EURO_OFFER_REQUIRED'};
 if(!Number.isFinite(Date.parse(plan.acceptedAt))||now-Date.parse(plan.acceptedAt)>=24*3600000||Date.parse(plan.acceptedAt)>now)
  return {status:'BLOCKED',reason:'CUSTOMER_TEXT_WINDOW_REQUIRED'};
 if(now-Date.parse(plan.acceptedAt)<3600000)return {status:'BLOCKED',reason:'WAIT_ONE_HOUR'};
 if(deps.requireAppliedAmount===true){
  let fresh=null;try{fresh=await deps.readCurrentAmount(plan);}catch{}
  const age=now-Date.parse(fresh?.readAt);
  if(fresh?.verified!==true||String(fresh.orderId)!==String(plan.orderId)||fresh.currency!=='EUR'||!Number.isFinite(age)||age<0||age>60000||Math.round(fresh.amount*100)!==plan.finalCents)return {status:'BLOCKED',reason:'WAIT_VERIFIED_DISCOUNT_AMOUNT'};
 }
 const messages=await deps.readMessages(plan.conversationId);
 if(existingDiscountAmountNotice(messages,plan))return {status:'VERIFIED',alreadySent:true};
 return sendDeliveryReplyOnce({...plan,hash:plan.snapshot,messageAt:plan.acceptedAt,messageId:plan.acceptanceMessageId},content,'discount_amount',deps);
}
