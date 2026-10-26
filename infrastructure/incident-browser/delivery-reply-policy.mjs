import {currentCustomerIntent,madridDate,resolutionHash,literalDeliveryPreference} from '../../autoconfirm/src/workflows/incident-intent-v2.mjs';
import {isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {preciseRetrySlot,requestedWindowWithoutDate} from './retry-policy.mjs';
import {nextBusinessMorning} from './business-day.mjs';
import {customerDeliverySignals,newDeliverySolution} from '../../autoconfirm/src/workflows/customer-delivery-intent.mjs';
import {deliveryContactContext,deliveryScheduleText,requestedDayOfMonth,paymentContext,paymentClarification,pickupContext} from './delivery-conversation-context.mjs';

export const NON_DELIVERY_ACK='Hola, no se preocupe y reportamos a la empresa de transporte para que le realicen la entrega. Un saludo';
const fold=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const nonDelivery=t=>customerDeliverySignals(t).reports_non_delivery||/\bno (?:me |nos |le |les )?(?:(?:ha|han|a|an|habia|habian) )?(?:llegado|entregado|recibido|visitado|llamado|traido)\b|\bno (?:me |nos )?(?:ha|han) realizado (?:la |ninguna )?entrega\b|\bno (?:se )?(?:(?:ha|han) )?(?:pasado|presentado|venido)\b|\b(?:no he rechazado|no lo he rechazado|cuando he dicho yo que no)\b/.test(t);
const explanation=t=>/^(?:estoy|estaba|estare) trabajando[.! ]*$/.test(t)||/^no (?:estaba|me encontraba) en casa[.! ]*$/.test(t);
const irrelevant=t=>/^[?¿!.,… ]*$/.test(t)||/^(?:hola|buenas tardes|buenos dias|(?:muchas )?gracias(?: a vosotros| a ustedes)?|ok|vale(?: gracias)?|otro dia o datos|confirmar mi pedido)[.! ]*$/.test(t)||/^[👍🙏🙌😊🙂\uFE0F\u{1F3FB}-\u{1F3FF} ]+$/u.test(t);
const wants=t=>customerDeliverySignals(t).wants_order||/\b(?:lo quiero|quiero (?:el|mi) pedido|quiero recibirlo|entregarmelo|pueden entregar|vuelvan a entregar)\b/.test(t);
const paymentConfirmed=t=>/\b(?:ya )?(?:tengo|dispongo de|dispongo del|cuento con) (?:el |del )?(?:efectivo|importe|dinero)\b/.test(t)&&
 !/\b(?:no|si me|si tengo|quizas?|tal vez|descuento|rebaja|cambiar el precio)\b/.test(t);
const hasPreference=t=>/\b(?:hoy|manana|tarde|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hora|horas|partir|despues|antes|desde|entre|cualquier dia)\b|\d/.test(t);
const iso=t=>new Date(t).toISOString();

export function deliveryReplyPlan({incident,order,issue,messages=[],now=Date.now()}){
 const block=reason=>({eligible:false,reason});
 const raw=issue?.raw||issue;
 if(!['absent','rejected_goods'].includes(incident.incidentType))return block('EXISTING_WORKFLOW_OWNER');
 if(!['RECIPIENT_ABSENT','REFUSED_BY_RECIPIENT'].includes(raw?.type))return block('EXISTING_PROVIDER_WORKFLOW_OWNER');
 if(String(raw?.id)!==String(incident.incidenceId)||String(raw?.order_id)!==String(incident.orderId)||String(order?.orderId)!==String(incident.orderId))return block('IDENTITY_CONFLICT');
 if(raw.status!=='PENDING'||raw.is_active!==true||raw.resolution_status||!['ERROR','INCIDENCE'].includes(order.status))return block('CURRENT_PENDING_ISSUE_REQUIRED');
 const base=currentCustomerIntent({incident,order,messages,now});
 if(base.status==='NOT_VERIFIABLE')return block(base.reason);
 const created=Date.parse(order.createdAt),anchor=Date.parse(base.notice_at||incident.incidenceDate);
 const incoming=messages.filter(isCustomerInteraction).filter(m=>messageTimestamp(m)>=Math.max(created,anchor))
  .sort((a,b)=>messageTimestamp(a)-messageTimestamp(b));
 const meaningful=incoming.filter(m=>!irrelevant(fold(addressMessageText(m))));
 if(!meaningful.length)return block('NO_CURRENT_DELIVERY_REPLY');
 const last=meaningful.at(-1),lastAt=messageTimestamp(last),lastText=addressMessageText(last);
 if(now-lastAt<3600000)return block('REPLY_SETTLING_WINDOW');
 const latestIncomingAt=messageTimestamp(incoming.at(-1));
 if(now-latestIncomingAt<3600000)return block('REPLY_SETTLING_WINDOW');
 if(now-latestIncomingAt>=24*3600000)return block('CUSTOMER_REPLY_WINDOW_EXPIRED');
 const cancelled=meaningful.filter(m=>/\b(?:no lo quiero|no quiero (?:el|mi) pedido|no quiero recibirlo|cancel|devol)/.test(fold(addressMessageText(m)))).at(-1);
 if(cancelled&&(messageTimestamp(cancelled)>=lastAt||!customerDeliverySignals(lastText).explicit_desire))return block('CANCELLATION_OR_RETURN_TAKES_PRECEDENCE');
 // Consecutive details form one reply. Never assemble an old instruction with
 // a later unrelated answer, or discard an explicit earlier preference.
 const cluster=meaningful.filter(m=>lastAt-messageTimestamp(m)<=30*60000&&(!cancelled||messageTimestamp(m)>messageTimestamp(cancelled)));
 const texts=cluster.map(addressMessageText),normalized=texts.map(fold),combined=normalized.join(' ');
 if(combined.length>1000||/https?:|ignora.*instrucciones|contrase|\btoken\b/.test(combined))return block('UNTRUSTED_OR_LONG_REPLY');
 if(/\b(?:no lo quiero|ya no|no quiero (?:el|mi) pedido|cancel|devol|anular|rechazo el pedido|no me lo envie)/.test(combined))return block('CANCELLATION_OR_RETURN_TAKES_PRECEDENCE');
 if(pickupContext(combined))return {...block('PICKUP_REQUIRES_VERIFIED_AGENCY'),context:{customerIntent:'REQUESTS_AGENCY',nextAction:'VERIFY_PICKUP_AVAILABILITY',missing:['VERIFIED_AGENCY_AVAILABILITY']}};
 if(/\b(?:agencia|recoger|recojo|direccion|calle|avenida|postal|piso|puerta)\b/.test(combined))return block('AGENCY_OR_ADDRESS_REQUIRES_EXISTING_OWNER');
 const contact=texts.map(deliveryContactContext);
 if(contact.some(c=>c.differentPhone))return block('CONTACT_CHANGE_REQUIRES_EXISTING_OWNER');
 const lastId=String(last.id||'');
 if(!/^\d+$/.test(lastId))return block('MESSAGE_IDENTITY_REQUIRED');
 const identity={orderId:String(order.orderId),issueId:String(raw.id),conversationId:incident.chatbyUserNs,
  messageId:lastId,messageAt:iso(lastAt),text:lastText,customerName:order.customerName,
  phone:String(order.customerPhone||'').replace(/\D/g,'').replace(/^34(?=\d{9}$)/,''),
  evidence:cluster.map(m=>({id:String(m.id),at:iso(messageTimestamp(m)),text:addressMessageText(m)}))};
 const finish=p=>{const plan={eligible:true,...identity,...p};return {...plan,hash:resolutionHash(plan)};};
 const clarify=(reason,content)=>finish({kind:'CLARIFY',reason,content});
 // A greeting/courtesy may reopen WhatsApp, but cannot renew an old delivery
 // instruction. Use that fresh message window only to request current details.
 if(now-lastAt>=24*3600000)return clarify('EARLIER_PREFERENCE_REQUIRES_RENEWAL',
  'Hola, para respetar sus indicaciones, confírmenos qué día y franja horaria le vienen bien ahora para solicitar una nueva entrega. Gracias.');
 const confirmedPayment=paymentConfirmed(normalized.at(-1));
 if(paymentContext(combined)&&!(confirmedPayment&&!/descuento|rebaja|cambiar el precio/.test(combined))){
  const segments=deliveryScheduleText(lastText).split(/[.!?;]\s+(?=\p{L})/u).map(t=>preciseRetrySlot(t,lastAt)).filter(s=>s.date);
  const unique=[...new Map(segments.map(s=>[`${s.date}:${s.time_window}`,s])).values()];
  const parsed=unique.length===1?unique[0]:{date:null,time_window:null},date=parsed.date||requestedDayOfMonth(combined,lastAt);
  return {...clarify('PAYMENT_OR_PRICE_NEEDS_CONFIRMATION',paymentClarification({date,window:parsed.time_window,order})),
   context:{customerIntent:'WANTS_DELIVERY_PAYMENT_UNCONFIRMED',requestedDate:date,requestedWindow:parsed.time_window,missing:['PAYMENT_CONFIRMATION',...(!date?['DELIVERY_DATE']:[]),...(!parsed.time_window?['DELIVERY_WINDOW']:[])]}};
 }
 if(/\bo mejor\b|\b(?:quizas?|tal vez|puede que)\b/.test(combined))return clarify('CONTRADICTORY_OR_UNCERTAIN_PREFERENCE',
  'Hola, para solicitar la entrega correctamente, indíquenos el día y el horario exactos que prefiere. Gracias.');
 const signals=customerDeliverySignals(combined),reportsNonDelivery=normalized.some(nonDelivery);
 if(signals.conditional)return clarify('CONDITIONAL_DELIVERY_REQUEST','Hola, indíquenos si quiere recibir el pedido y qué condición necesitamos resolver para solicitar la entrega. Gracias.');
 let selected=null,slot=null,recurring=false,scheduleSource=null,literalPreference=null;
 for(let n=0;n<texts.length;n++){
  let t=deliveryScheduleText(texts[n]).replace(/(\d)\s*hs?\b/g,'$1 h');
  if(contact[n].contactOnly)continue;
  if(explanation(t)||irrelevant(t)||confirmedPayment&&/efectivo|dinero|importe/.test(t)&&!hasPreference(t))continue;
  if(hasPreference(t)){
   let parsed=preciseRetrySlot(t,messageTimestamp(cluster[n]));
   const every=/\bcualquier dia(?: de la semana)?\b/.test(t);
   const clean=t.replace(/\bcualquier dia(?: de la semana)?\b/,'').replace(/\b(?:q|que) es cuando termino\b.*$/,'').trim();
   const window=requestedWindowWithoutDate(clean);
   const literal=literalDeliveryPreference(texts[n],messageTimestamp(cluster[n]),now);
   if(literal&&(!parsed.date||!parsed.time_window)){
    selected=cluster[n];slot={date:literal.date||slot?.date||null,time_window:null};literalPreference=literal;scheduleSource='CUSTOMER_LITERAL_PREFERENCE';
   }else if(parsed.date||window){
    literalPreference=null;
    if(parsed.date)scheduleSource='CUSTOMER_EXPLICIT';
    if(!parsed.date&&window){const next=slot?.date?slot:nextBusinessMorning(now,order);if(!next)return block('BUSINESS_CALENDAR_REQUIRED');if(!slot?.date)scheduleSource='OWNER_NEXT_BUSINESS_CUSTOMER_WINDOW';parsed={...next,time_window:window};}
    selected=cluster[n];slot=parsed;recurring=every;
   }else return clarify('PRECISE_PREFERENCE_NEEDS_CLARIFICATION',
    'Hola, para respetar su disponibilidad, indíquenos un día y un horario concretos para solicitar la entrega. Gracias.');
  }else if(!nonDelivery(t)&&!wants(t))return clarify('CUSTOMER_MESSAGE_NEEDS_CLARIFICATION',
   'Hola, ¿quiere que solicitemos una nueva entrega de su pedido? Si es así, indíquenos el día y la franja horaria en que puede recibirlo. Gracias.');
 }
 if(!reportsNonDelivery&&!selected&&!normalized.some(wants))return confirmedPayment?clarify('DELIVERY_SCHEDULE_AFTER_PAYMENT_REQUIRED',
  'Gracias por confirmarlo. ¿Qué día y en qué franja horaria puede recibir su pedido?'):block('NO_DELIVERY_REQUEST');
 if(!selected){
  const earlier=meaningful.filter(m=>!cluster.includes(m));
  if(earlier.some(m=>hasPreference(fold(addressMessageText(m)))))return clarify('EARLIER_PREFERENCE_REQUIRES_RENEWAL',
   'Hola, queremos respetar el horario que nos indicó. Confírmenos qué día y franja horaria le vienen bien para solicitar una nueva entrega. Gracias.');
 }
 if(literalPreference&&slot?.date&&slot.date<=madridDate(now))return clarify('REQUESTED_DELIVERY_WINDOW_EXPIRED','Hola, la fecha de entrega indicada ya necesita renovarse. Confírmenos qué día le viene bien para solicitar una nueva entrega. Gracias.');
 if(slot&&!literalPreference){
  const today=madridDate(now),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
  if(!slot.time_window||slot.date<today||(slot.date===today&&hour>=({morning:14,afternoon:21}[slot.time_window]||0)))return clarify('REQUESTED_DELIVERY_WINDOW_EXPIRED',
   'Hola, el horario de entrega que nos indicó ya ha pasado o necesita concretarse. ¿Qué nuevo día y franja horaria le vienen bien? Gracias.');
 }
 if(!raw.allowed_resolution_options?.includes('PROVIDE_SOLUTION'))return block('PROVIDER_SOLUTION_NOT_ALLOWED');
 const preference=selected?addressMessageText(selected):null;
 const note=[signals.waiting_for_order?newDeliverySolution(signals):'El cliente quiere recibir su pedido.',!signals.waiting_for_order&&reportsNonDelivery?'Indica que no se ha realizado la entrega o niega haberla rechazado.':null,
  slot?.date&&slot?.time_window?`${scheduleSource==='CUSTOMER_EXPLICIT'?'Solicita entrega':'Proponemos próxima fecha hábil de entrega'} el ${slot.date} por la ${slot.time_window==='morning'?'mañana':'tarde'}.`:literalPreference?.date?`Fecha solicitada: ${literalPreference.date}; horario según indicación literal del cliente.`:null,
  preference?`Disponibilidad literal del cliente: «${preference}».`:null,
  recurring?'La disponibilidad indicada es recurrente.':null,
  contact.some(c=>c.callBeforeArrival)?'El cliente solicita que le llamen antes de llegar.':null,
  'Por favor, gestionar la entrega respetando sus indicaciones.'].filter(Boolean).join(' ');
 if(note.length>500)return block('SOLUTION_NOTE_TOO_LONG');
 return finish({kind:'SOLUTION',customer_intent:'WANTS_ORDER',waiting_for_order:signals.waiting_for_order,delivery_attempt_denied_by_customer:signals.delivery_attempt_denied_by_customer,requests_redelivery:true,provider_raw_type:raw.type,next_best_action:'PROVIDE_SOLUTION_NEW_DELIVERY',reason:signals.delivery_attempt_denied_by_customer?'CUSTOMER_REPORTS_NO_DELIVERY_ATTEMPT':reportsNonDelivery?'CUSTOMER_REPORTS_NON_DELIVERY':'CUSTOMER_DELIVERY_PREFERENCE',
  note,acknowledgement:reportsNonDelivery?NON_DELIVERY_ACK:null,date:slot?.date||null,time_window:slot?.time_window||null,
  scheduleSource,callBeforeArrival:contact.some(c=>c.callBeforeArrival),preferenceMessageId:selected?String(selected.id):null});
}
