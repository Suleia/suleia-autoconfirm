import {questionContext,fold} from '../customer-care/context.mjs';
import {addressMessageText} from '../workflows/address-response-policy.mjs';
export function contextualQuestion(message){
  const text=fold(message.payload?.body||addressMessageText(message)),type=questionContext(message);
  if(type==='LEGACY_PAYMENT'){
    const day=/dia|fecha/.test(text),window=/franja|horario|manana.*tarde/.test(text);
    return day&&window?'DATE_AND_WINDOW':day?'DATE':window?'TIME_WINDOW':'LEGACY_PAYMENT';
  }
  return type||(/[?¿]/.test(text)?'UNCLASSIFIED_QUESTION':null);
}
