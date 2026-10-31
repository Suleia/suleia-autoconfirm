import {questionContext,fold} from '../customer-care/context.mjs';
import {addressMessageText} from '../workflows/address-response-policy.mjs';
export function contextualQuestion(message){
  const text=fold(message.payload?.body||addressMessageText(message)),type=questionContext(message);
  if(/(?:quiere|interesad[oa]|prefiere).*recog.*(?:agencia|oficina|gls)/.test(text))return 'AGENCY_PICKUP';
  if(/\b(?:agencia|oficina|almacen)\b/.test(text)&&/\b(?:quiere|prefiere|avisemos)\b.*\b(?:recoger|recogerla|recogerlo|pasara|pasar)\b/.test(text))return 'AGENCY_PICKUP';
  if(/quiere (?:el )?producto/.test(text))return 'WANTS_ORDER';
  if(type==='DATE_AND_WINDOW'&&/quiere.*(?:pedido|entrega)/.test(text))return 'WANTS_ORDER_AND_SCHEDULE';
  if(type==='LEGACY_PAYMENT'){
    const day=/dia|fecha/.test(text),window=/franja|horario|manana.*tarde/.test(text);
    return day&&window?'DATE_AND_WINDOW':day?'DATE':window?'TIME_WINDOW':'LEGACY_PAYMENT';
  }
  return type||(/[?¿]/.test(text)?'UNCLASSIFIED_QUESTION':null);
}
export function remainingQuestion(question,facts){
  const types=new Set(facts.map(f=>f.type));
  if(question==='WANTS_ORDER_AND_SCHEDULE'){
    if(facts.some(f=>f.type==='WANTS_RETURN'&&f.value===true))return null;
    if(facts.some(f=>f.type==='WANTS_ORDER'&&f.value===true))return remainingQuestion('DATE_AND_WINDOW',facts);
    return question;
  }
  if(['WANTS_ORDER','CONFIRM_ORDER','DISCOUNT','AGENCY_PICKUP','UNCLASSIFIED_QUESTION'].includes(question))return null;
  const date=types.has('DELIVERY_DATE'),window=['DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].some(t=>types.has(t));
  if(question==='DATE_AND_WINDOW')return date&&window?null:date?'TIME_WINDOW':window?'DATE':question;
  if(question==='DATE'&&date||question==='TIME_WINDOW'&&window)return null;
  return question;
}
