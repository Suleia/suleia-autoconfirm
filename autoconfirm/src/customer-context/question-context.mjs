import {questionContext,fold} from '../customer-care/context.mjs';
import {addressMessageText} from '../workflows/address-response-policy.mjs';
export function contextualQuestion(message){
  const text=fold(message.payload?.body||addressMessageText(message)),type=questionContext(message);
  if(/(?:quiere|interesad[oa]|prefiere).*recog.*(?:agencia|oficina|gls)/.test(text))return 'AGENCY_PICKUP';
  if(/quiere (?:el )?producto/.test(text))return 'WANTS_ORDER';
  if(type==='LEGACY_PAYMENT'){
    const day=/dia|fecha/.test(text),window=/franja|horario|manana.*tarde/.test(text);
    return day&&window?'DATE_AND_WINDOW':day?'DATE':window?'TIME_WINDOW':'LEGACY_PAYMENT';
  }
  return type||(/[?¿]/.test(text)?'UNCLASSIFIED_QUESTION':null);
}
export function remainingQuestion(question,facts){
  const types=new Set(facts.map(f=>f.type));
  if(['WANTS_ORDER','CONFIRM_ORDER','DISCOUNT','AGENCY_PICKUP','UNCLASSIFIED_QUESTION'].includes(question))return null;
  const date=types.has('DELIVERY_DATE'),window=['DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].some(t=>types.has(t));
  if(question==='DATE_AND_WINDOW')return date&&window?null:date?'TIME_WINDOW':window?'DATE':question;
  if(question==='DATE'&&date||question==='TIME_WINDOW'&&window)return null;
  return question;
}
