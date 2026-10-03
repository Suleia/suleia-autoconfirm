import { createHash } from 'node:crypto';
import { isCustomerInteraction, messageTimestamp, findVerifiedTemplateDelivery } from './incident-discount-policy.mjs';
import { addressMessageText, parseCustomerAddress } from './address-response-policy.mjs';

export const resolutionHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function madridDate(at) {
  if (!Number.isFinite(Number(at))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0,10);

// Conservative adapter for the existing Madrid/date/window vocabulary. Relative
// dates are anchored to the customer event, never to a later processing cycle.
export function deliverySlot(text, at) {
  const t=fold(text), day=madridDate(at), empty={date:null,time_window:null};
  if (!day || /\b(?:no|o|quizas?|tal vez|puede que|pasado)\b/.test(t)) return empty;
  const dates=[...t.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m=>m[1]);
  const spanish=[...t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)];
  for(const m of spanish) dates.push(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const named=[...t.matchAll(new RegExp(`\\b(\\d{1,2}) de (${months.join('|')})(?: de (\\d{4}))?\\b`,'g'))];
  for(const m of named) dates.push(`${m[3]||day.slice(0,4)}-${String(months.indexOf(m[2])+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  if(/\bmanana\b/.test(t.replace(/por la manana/g,''))) dates.push(addDays(day,1));
  const weekdays=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
  for(const w of weekdays.filter(w=>new RegExp(`\\b${w}\\b`).test(t))) dates.push(addDays(day,(weekdays.indexOf(w)-new Date(`${day}T12:00:00Z`).getUTCDay()+7)%7||7));
  if(/esta tarde/.test(t))dates.push(day);
  if(dates.length!==1 || !Number.isFinite(Date.parse(dates[0])) || new Date(dates[0]).toISOString().slice(0,10)!==dates[0] || dates[0]<day) return empty;
  const morning=/por la manana/.test(t), afternoon=/por la tarde|esta tarde/.test(t);
  // Do not discard a more precise or contradictory time preference.
  const remainder=t.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g,'').replace(new RegExp(`\\d{1,2} de (${months.join('|')})(?: de \\d{4})?`,'g'),'');
  return {date:dates[0],time_window:morning!==afternoon&&!/\d|antes|despues|hasta|a partir/.test(remainder)?morning?'morning':'afternoon':null};
}

export function parseCustomerIntentV2(text, {at, offerVerified=false, button=null}={}) {
  const t=fold(text), ambiguous=reason=>({intents:['AMBIGUOUS'],confidence:'LOW',reason,slot:{date:null,time_window:null}});
  if(!t&&!button)return {intents:['IRRELEVANT'],confidence:'HIGH',slot:{date:null,time_window:null}};
  if(t.length>1000 || /https?:|ignora.*instrucciones|\b(?:quiza|quizas|no se|tal vez|puede que)\b/.test(t))return ambiguous('AMBIGUOUS_CUSTOMER_RESPONSE');
  if(/^(hola|buenos dias|buenas tardes|gracias|ok|vale)[!., ]*$/.test(t))return {intents:['IRRELEVANT'],confidence:'HIGH',slot:{date:null,time_window:null}};
  let slot=deliverySlot(t,at);
  const intents=[];
  const returns=/\b(?:ya no lo quiero|no lo quiero|no quiero (?:el|este) pedido|devolver|devolverlo|devuelvelo|cancelalo)\b/.test(t)||button==='REQUEST_RETURN';
  const wants=/\b(?:lo quiero|quiero (?:el|mi) pedido|quiero recibirlo|vuelvan a entregar|entregar de nuevo|reintentar)\b/.test(t)&&!returns;
  const rejectDiscount=/\b(?:sin descuento|no quiero (?:el )?descuento|rechazo (?:el )?descuento)\b/.test(t)||button==='REJECT_DISCOUNT';
  const accepts=/\b(?:acepto (?:el )?descuento|quiero (?:el )?descuento|con (?:los |el )?(?:5|cinco) euros|con (?:el )?descuento)\b/.test(t)||/^acepto[.! ]*$/.test(t)||button==='ACCEPT_DISCOUNT_5';
  if(returns && /no (?:quiero )?devolver|no lo devuelv/.test(t))return ambiguous('NEGATED_RETURN');
  if(returns&&(accepts||wants||slot.date))return ambiguous('CONTRADICTORY_CUSTOMER_RESPONSE');
  if(accepts&&rejectDiscount)return ambiguous('CONTRADICTORY_CUSTOMER_RESPONSE');
  if(returns)intents.push('WANTS_RETURN');
  if(rejectDiscount)intents.push('REJECTS_DISCOUNT');
  if(accepts){if(!offerVerified)return ambiguous('VERIFIED_OFFER_REQUIRED');intents.push('ACCEPTS_DISCOUNT','WANTS_ORDER');}
  if(wants)intents.push('WANTS_ORDER');
  if(/recog(?:er|ida|erlo).*agencia|recojo.*(?:agencia|oficina)/.test(t)||button==='ABSENT_PICKUP_AGENCY')intents.push('REQUESTS_AGENCY','WANTS_ORDER');
  if(button==='ABSENT_TOMORROW_MORNING'||button==='ABSENT_TOMORROW_AFTERNOON')slot={date:addDays(madridDate(at),1),time_window:button.endsWith('MORNING')?'morning':'afternoon'};
  if(slot.date)intents.push('PROVIDES_DATE','REQUESTS_RETRY','WANTS_ORDER');
  if(slot.time_window)intents.push('PROVIDES_TIME_WINDOW');
  const address=parseCustomerAddress(text);
  if(['VALID_ADDRESS','INCOMPLETE_ADDRESS'].includes(address.kind))intents.push('PROVIDES_ADDRESS');
  if(/(?:direccion|datos).*(?:correct[ao]s?|mism[ao]s?)|confirmo (?:la|mi) direccion/.test(t))intents.push('CONFIRMS_ADDRESS');
  if(/[?¿]/.test(t)||/^(?:cuando|donde|como|por que)\b/.test(t))return {intents:['ASKS_QUESTION'],confidence:'HIGH',slot};
  if(intents.includes('WANTS_RETURN')&&intents.some(i=>['REQUESTS_AGENCY','PROVIDES_ADDRESS','CONFIRMS_ADDRESS'].includes(i)))return ambiguous('CONTRADICTORY_CUSTOMER_RESPONSE');
  return {intents:intents.length?[...new Set(intents)]:['AMBIGUOUS'],confidence:intents.length?'HIGH':'LOW',slot};
}

export function currentCustomerIntent({incident,order,messages=[],now=Date.now()}) {
  const unknown=reason=>({status:'NOT_VERIFIABLE',intents:['AMBIGUOUS'],confidence:'LOW',reason,event_hash:null,has_reply:false});
  if(incident.chatbyReadVerified!==true || incident.chatbyOrderAssociation!=='EXACT_ORDER' || !incident.chatbyUserNs || String(order?.orderId)!==String(incident.orderId))return unknown('EXACT_ORDER_EVIDENCE_REQUIRED');
  const created=Date.parse(order.createdAt), opened=Date.parse(incident.incidenceDate);
  if(!Number.isFinite(created)||!Number.isFinite(opened))return unknown('CURRENT_ORDER_TIMESTAMP_REQUIRED');
  if(messages.some(m=>(m.user_ns&&String(m.user_ns)!==String(incident.chatbyUserNs))||(m.order_id&&String(m.order_id)!==String(incident.orderId))))return unknown('CONVERSATION_IDENTITY_CONFLICT');
  const template={rejected_goods:'dropea_incidencia_mercancia_v1',absent:'dropea_ausente_v3',address:'dropea_incidencia_direccion_v1'}[incident.incidentType];
  const scoped=messages.filter(m=>messageTimestamp(m)>=created);
  const notice=template&&findVerifiedTemplateDelivery(scoped,template);
  // Current incident OR verified same-order notice (templates are once/order).
  const anchor=notice?Date.parse(notice.sentAt):opened;
  const inbound=scoped.filter(isCustomerInteraction);
  if(messages.filter(isCustomerInteraction).some(m=>!Number.isFinite(messageTimestamp(m))||messageTimestamp(m)>now))return unknown('CUSTOMER_EVENT_TIMESTAMP_INVALID');
  const replies=[...new Map(inbound.filter(m=>messageTimestamp(m)>=anchor).map(m=>[String(m.id||m.mid||resolutionHash(m)),m])).values()].sort((a,b)=>messageTimestamp(a)-messageTimestamp(b));
  const base={notice_at:notice?.sentAt||null,has_reply:replies.length>0,reply_count:replies.length};
  let selected=null;
  for(const m of replies){
    const at=messageTimestamp(m), raw=m.raw||m;
    const offer=findVerifiedTemplateDelivery(scoped.filter(v=>messageTimestamp(v)<at),'es_es_dropea_incidencia_descuento_5_v1');
    const button=raw.button_verified===true&&raw.order_id&&String(raw.order_id)===String(incident.orderId)?raw.button_payload:null;
    const parsed=parseCustomerIntentV2(addressMessageText(m),{at,offerVerified:!!offer,button});
    if(parsed.intents.includes('IRRELEVANT'))continue;
    const next={...parsed,at:new Date(at).toISOString(),event_hash:resolutionHash([incident.orderId,at,addressMessageText(m),button]),evidence:button?'VERIFIED_STRUCTURED_BUTTON':'EXACT_ORDER_TEXT',offer_verified:!!offer};
    if(selected?.at===next.at&&selected.event_hash!==next.event_hash)return {...unknown('SIMULTANEOUS_RESPONSE_CONFLICT'),...base};
    selected=next;
  }
  return {...base,...(selected||{intents:[],confidence:'HIGH',at:null,event_hash:null}),status:selected?'RESPONDED':replies.length?'IRRELEVANT_RESPONSE':'NO_RESPONSE'};
}
