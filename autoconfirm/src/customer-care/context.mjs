import {createHash} from 'node:crypto';
import {isCustomerInteraction,messageTimestamp,extractWamid} from '../workflows/incident-discount-policy.mjs';
import {addressMessageText,parseCustomerAddress} from '../workflows/address-response-policy.mjs';
import {madridDate,deliverySlot} from '../workflows/incident-intent-v2.mjs';
import {customerDeliverySignals} from '../workflows/customer-delivery-intent.mjs';

export const CARE_VERSION='CUSTOMER_CARE_V1';
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const iso=at=>Number.isFinite(at)?new Date(at).toISOString():null;
const addDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export const OWNERS=Object.freeze({CONFIRM_ORDER:'existing_confirmation_workflow',AUTO_CANCEL:'existing_cancellation_workflow',SEND_INITIAL_TEMPLATE:'existing_initial_template_owner',SEND_REMINDER:'existing_reminder_owner',SEND_PREPARED:'existing_prepared_owner',DISCOUNT_OFFER:'existing_discount_workflow',DISCOUNT_ACCEPT:'existing_accepted_discount_workflow',RETURN:'existing_return_workflow',ABSENT_NOTICE:'existing_absent_owner',ADDRESS:'existing_address_workflow',REDELIVERY:'existing_incident_action_gateway',AGENCY:'existing_incident_action_gateway',INTERPRET_CUSTOMER:'SULEIA_CUSTOMER_CARE_AGENT',CONTEXTUAL_CLARIFICATION:'vps_delivery_reply',STATUS_REPLY:'vps_delivery_reply'});
export const INTENTS=Object.freeze(['WANTS_ORDER','WANTS_RETURN','CANCELS_ORDER','ACCEPTS_DISCOUNT','REJECTS_DISCOUNT','REQUESTS_REDELIVERY','REQUESTS_AGENCY','PROVIDES_DATE','PROVIDES_TIME_WINDOW','PROVIDES_EXACT_TIME','CHANGES_ADDRESS','PROVIDES_ADDRESS','CONFIRMS_ADDRESS','REPORTS_NO_DELIVERY_ATTEMPT','REPORTS_DAMAGE','REPORTS_MISSING_ITEM','REPORTS_WRONG_PRODUCT','ASKS_STATUS','ASKS_DELIVERY_DATE','ASKS_PAYMENT','ASKS_PRODUCT','ASKS_USAGE','COMPLAINT','THANKS','GREETING','AMBIGUOUS','IRRELEVANT']);

export function questionContext(message){
 const text=fold(message?.payload?.body||addressMessageText(message));
 const name=fold(message?.payload?.name||'');
 if(/descuento_5/.test(name))return 'DISCOUNT';
 if(/dropea_pedido_(?:nuevo|reminder)/.test(name))return 'CONFIRM_ORDER';
 if(/confirm.*(?:efectivo|dispondra)|dispon.*efectivo/.test(text))return 'LEGACY_PAYMENT';
 if(/codigo postal/.test(text)&&/[?¿]|indique|falta/.test(text))return 'POSTAL_CODE';
 if(/direccion/.test(text)&&/[?¿]|indique|falta/.test(text))return 'ADDRESS';
 const day=/que dia|que fecha|un dia|dia y|fecha y|nuevo dia/.test(text);
 const window=/franja|horario|manana o.*tarde|tarde o.*manana/.test(text);
 if(day&&window)return 'DATE_AND_WINDOW';
 if(window)return 'TIME_WINDOW';
 if(day)return 'DATE';
 if(/quiere.*(?:pedido|entrega)|sigue queriendo/.test(text))return 'WANTS_ORDER';
 return null;
}

// Pure interpretation: dates are anchored to the customer's event. No provider
// writes, policies, generated prose, external models or guessed card support.
export function interpretMessage(message,{question=null,offerVerified=false,at=messageTimestamp(message),incidentType=null}={}){
 const literal=addressMessageText(message),t=fold(literal),intents=[],facts={},uncertainties=[];
 const add=(...names)=>intents.push(...names);
 if(!t)return {intents:['IRRELEVANT'],facts,confidence:1,evidence:[]};
 if(t.length>2000||/https?:|ignora.*instrucciones|\b(?:token|password|contrasena)\b/.test(t))return {intents:['AMBIGUOUS'],facts,confidence:0,reason:'UNTRUSTED_CUSTOMER_INPUT',evidence:[]};
 const signal=customerDeliverySignals(literal);
 const negative=/\b(?:no lo quiero|no quiero (?:el|mi|este) pedido|no quiero recibirlo|ya no lo quiero|devolver(?:lo)?|devuelv(?:elo|anlo)|cancel(?:a|ar|alo|en)|anul(?:ar|alo|en))\b/.test(t)&&!/no (?:quiero )?(?:devolver|cancelar|anular)|no lo devuelv/.test(t);
 const explicitPositive=/\b(?:si[, ]+)?(?:lo quiero|quiero (?:el|mi) pedido|quiero recibirlo|quiero que.*(?:entreguen|traigan)|solicito.*entrega|confirmo (?:el|mi) pedido|confirmar mi pedido)\b/.test(t)&&!negative;
 const yes=/^(?:si|si por favor|claro|de acuerdo|acepto)[!. ,]*$/.test(t);
 const no=/^no[!. ,]*$/.test(t);
 const declineDiscount=/no quiero (?:el )?descuento|sin descuento|rechazo (?:el )?descuento/.test(t);
 const negativeOrder=negative&&!declineDiscount;
 if(signal.conditional||signal.contradictory||/\b(?:quizas?|tal vez|solo si|puede que)\b/.test(t))uncertainties.push('CONDITIONAL_OR_CONTRADICTORY_INTENT');
 if(/\bno (?:lo )?he pedido|no hice (?:el|este) pedido|yo no pedi/.test(t))uncertainties.push('ORDER_ORIGIN_DISPUTED');
 if(/\bno (?:puedo|quiero).*\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|tarde|hoy)\b/.test(t)&&!/\b(?:pero|mejor|sino)\b/.test(t))uncertainties.push('NEGATED_DELIVERY_PREFERENCE');
 if(/\bno (?:tengo|dispongo|puedo pagar)|sin (?:dinero|efectivo)/.test(t))facts.payment_constraint='CUSTOMER_REPORTED_UNAVAILABLE';
 if(/\b(?:ya tengo|ya dispongo|puedo pagar)\b/.test(t)&&!/\bno\b/.test(t))facts.payment_constraint=null;
 if(negativeOrder||no&&question==='WANTS_ORDER'||no&&question==='DISCOUNT'){
  add('WANTS_RETURN');facts.wants_return=true;facts.wants_order=false;facts.cancel_intent=true;
  if(/cancel|anul/.test(t))add('CANCELS_ORDER');
  if(offerVerified)add('REJECTS_DISCOUNT');
 }
 if(declineDiscount)add('REJECTS_DISCOUNT');
 if(explicitPositive||signal.wants_order&&!negativeOrder||yes&&['WANTS_ORDER','CONFIRM_ORDER'].includes(question)){
  add('WANTS_ORDER');facts.wants_order=true;facts.wants_return=false;facts.cancel_intent=false;
 }
 const accepts=/acepto (?:el )?descuento|quiero (?:el )?descuento|con (?:el )?descuento/.test(t)||yes&&question==='DISCOUNT';
 if(accepts){if(offerVerified&&!negativeOrder){add('ACCEPTS_DISCOUNT','WANTS_ORDER');facts.discount_response='ACCEPTED';facts.wants_order=true;facts.wants_return=false;facts.cancel_intent=false;}else uncertainties.push('VERIFIED_CURRENT_OFFER_REQUIRED');}
 if(intents.includes('REJECTS_DISCOUNT'))facts.discount_response='REJECTED';
 if(intents.includes('WANTS_ORDER')&&['absent','rejected_goods','address'].includes(incidentType))add('REQUESTS_REDELIVERY');
 if(signal.delivery_attempt_denied_by_customer){add('REPORTS_NO_DELIVERY_ATTEMPT');facts.reports_no_delivery_attempt=true;}
 if(/\b(?:recoger|recogida|recojo|retirar)\b.*\b(?:agencia|oficina|sucursal)\b/.test(t)){add('REQUESTS_AGENCY','WANTS_ORDER');facts.agency_requested=true;facts.wants_order=true;facts.wants_return=false;}
 const clockSource=t.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,'');
 const ranges=[...clockSource.matchAll(/\b(?:entre (?:las? )?|de (?:las? )?)(\d{1,2})(?::(\d{2}))?\s*(?:y|a|hasta|-)\s*(?:las? )?(\d{1,2})(?::(\d{2}))?\b/g)];
 const clocks=[...clockSource.matchAll(/\b(?:a las?|desde las?|a partir de las?|despues de las?|hasta las?)\s*(\d{1,2})(?::(\d{2}))?\b/g)];
 const hour=(h,m)=>Number(h)<=23&&Number(m||0)<=59?`${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}`:null;
 const morning=/por la manana|\bmanana\b/.test(t)&&!/^manana[.! ]*$/.test(t)&&!/manana por la tarde/.test(t);
 const afternoon=/por la tarde|esta tarde|\btarde[!. ,]*$/.test(t);
 if(ranges.length===1){const r=ranges[0];if(Number(r[1])<8&&!morning&&!afternoon||Number(r[3])<8&&!morning&&!afternoon)uncertainties.push('AMBIGUOUS_CLOCK');else{
  facts.time_from=hour(Number(r[1])+(afternoon&&Number(r[1])<12?12:0),r[2]);facts.time_to=hour(Number(r[3])+(afternoon&&Number(r[3])<12?12:0),r[4]);
  if(!facts.time_from||!facts.time_to||facts.time_from>=facts.time_to){delete facts.time_from;delete facts.time_to;uncertainties.push('INVALID_TIME_RANGE');}else add('PROVIDES_TIME_WINDOW');
 }}else if(clocks.length===1){const c=clocks[0];if(Number(c[1])<8&&!morning&&!afternoon)uncertainties.push('AMBIGUOUS_CLOCK');else{
  const value=hour(Number(c[1])+(afternoon&&Number(c[1])<12?12:0),c[2]);
  if(value){facts[/hasta/.test(c[0])?'time_to':'time_from']=value;add('PROVIDES_EXACT_TIME');}else uncertainties.push('INVALID_CLOCK');
 }}else if(ranges.length>1||clocks.length>1)uncertainties.push('MULTIPLE_CLOCKS');
 if(morning!==afternoon){facts.delivery_window=morning?'MORNING':'AFTERNOON';add('PROVIDES_TIME_WINDOW');}
 else if(morning&&afternoon)uncertainties.push('CONTRADICTORY_WINDOW');
 let date=deliverySlot(t,at).date;
 const eventDay=madridDate(at),wd=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
 const weekdays=wd.filter(w=>new RegExp('\\b'+w+'\\b').test(t));
 if(weekdays.length===1){const delta=(wd.indexOf(weekdays[0])-new Date(eventDay+'T12:00:00Z').getUTCDay()+7)%7;date=addDays(eventDay,delta||(/proximo|siguiente semana/.test(t)?7:0));}
 if(/\bhoy\b|esta tarde|esta manana/.test(t))date=eventDay;
 if(/pasado manana/.test(t))date=addDays(eventDay,2);
 if(/^manana[!. ]*$/.test(t)){if(question==='TIME_WINDOW'){facts.delivery_window='MORNING';add('PROVIDES_TIME_WINDOW');}else date=addDays(eventDay,1);}
 if(date&&validDate(date)){facts.delivery_date=date;add('PROVIDES_DATE');}
 if((facts.delivery_date||facts.delivery_window||facts.time_from||facts.time_to)&&!negativeOrder){facts.wants_order=true;facts.wants_return=false;facts.cancel_intent=false;add('WANTS_ORDER');if(incidentType)add('REQUESTS_REDELIVERY');}
 if(/\b(?:llam\w*|avis\w*)\b.*\bantes\b/.test(t))facts.call_before_arrival=!/\bno (?:me |nos )?(?:llam|avis)/.test(t);
 if(/\b(?:cambiar|cambio|otra|nueva|corregir)\b.*\bdireccion\b/.test(t)){add('CHANGES_ADDRESS');facts.address_change_requested=true;}
 const address=parseCustomerAddress(literal);
 if(['VALID_ADDRESS','INCOMPLETE_ADDRESS'].includes(address.kind)&&['street','number','postal_code','city','floor','door','province','country'].some(k=>address[k])){add('PROVIDES_ADDRESS');facts.address=address;facts.address_complete=address.kind==='VALID_ADDRESS';facts.address_change_requested=true;}
 if(question==='POSTAL_CODE'&&/^\d{5}$/.test(t))facts.postal_code=t;
 if(/confirmo.*direccion|direccion.*correcta/.test(t))add('CONFIRMS_ADDRESS');
 if(/no ha llegado|donde (?:esta|va)|estado.*pedido|seguimiento|sigo esperando/.test(t)){add('ASKS_STATUS');facts.asks_status=true;}
 if(/cuando.*(?:llega|entrega)|fecha.*entrega/.test(t))add('ASKS_DELIVERY_DATE');
 if(/[?¿]|^(?:cuanto|como|que|cual|puedo)\b/.test(t)){
  if(/pagar|pago|importe|cuanto cuesta|efectivo|tarjeta/.test(t))add('ASKS_PAYMENT');
  if(/que.*pedido|que.*producto|ingrediente|para que sirve/.test(t))add('ASKS_PRODUCT');
  if(/como.*(?:usar|aplicar|tomar)|modo de uso|cuantas veces/.test(t))add('ASKS_USAGE');
 }
 if(/roto|danado|estropeado|derramado/.test(t))add('REPORTS_DAMAGE');
 if(/falta.*(?:unidad|producto|articulo)|incompleto/.test(t))add('REPORTS_MISSING_ITEM');
 if(/producto equivocado|no es lo que pedi|otro producto/.test(t))add('REPORTS_WRONG_PRODUCT');
 if(/queja|reclamacion|verg[uü]enza|estafa/.test(t)){add('COMPLAINT');facts.complaint=true;}
 if(/^(?:hola|buenos dias|buenas tardes|buenas)[!. ]*$/.test(t))add('GREETING');
 if(/^(?:muchas )?gracias(?: a vosotros| a ustedes)?[!. ]*$/.test(t)||/^[👍🙏😊🙂 ]+$/u.test(t))add('THANKS');
 if(!intents.length)add(Object.keys(facts).length?'IRRELEVANT':'AMBIGUOUS');
 if(negativeOrder&&accepts||uncertainties.length){add('AMBIGUOUS');if(negativeOrder&&accepts)uncertainties.push('CONTRADICTORY_INTENT');}
 return {intents:[...new Set(intents)],facts,confidence:uncertainties.length?0.5:intents.includes('AMBIGUOUS')?0.3:0.98,uncertainties,evidence:[{message_id:String(message.id||message.mid),at:iso(at),hash:hash(literal)}]};
}

export function emptyCase({order,incident,conversationId,canonicalOrderId=String(order.orderId)}){
 return {schema_version:CARE_VERSION,canonical_order_id:canonicalOrderId,dropea_order_id:String(order.orderId),active_issue_id:incident?.incidenceId?String(incident.incidenceId):null,conversation_reference:conversationId,
  current_order_state:order.status,current_incident_type:incident?.incidentType||null,latest_customer_intents:[],latest_intent_at:null,wants_order:null,wants_return:false,cancel_intent:false,discount_offered:false,discount_response:null,discount_applied_verified:false,
  delivery_date:null,delivery_window:null,time_from:null,time_to:null,call_before_arrival:null,payment_method:null,amount_due:null,allowed_payment_methods:[],payment_information_sent:false,address_change_requested:false,address_complete:false,address_verified:false,address:null,postal_code:null,agency_requested:false,reports_no_delivery_attempt:false,asks_status:false,complaint:false,
  last_outbound_question_type:null,last_outbound_question_at:null,last_outbound_message_hash:null,waiting_for_customer:false,waiting_for_provider:false,last_verified_action:null,next_best_action:null,conversation_version:0,event_versions:{},fact_evidence:{},clarifications:[],findings:[],timeline:[],status:'OBSERVING',updated_at:null};
}

export function buildCustomerCase(input,previous=null){
 const {order,incident,messages=[],now=Date.now(),binding,policy={}}=input;
 const conversationId=incident?.chatbyUserNs||input.conversationId;
 const canonicalOrderId=String(input.canonicalOrderId||order?.orderId||'');
 const failure=reason=>({...emptyCase({order:order||{},incident,conversationId,canonicalOrderId}),status:'HUMAN_REVIEW',next_best_action:'HUMAN_REVIEW',reason,confidence:0,updated_at:iso(now)});
 if(!order?.orderId||!conversationId||binding?.verified!==true||String(binding.orderId)!==String(order.orderId)||binding.conversationId!==conversationId||incident&&String(incident.orderId)!==String(order.orderId))return failure('EXACT_ORDER_BINDING_REQUIRED');
 if(incident&&String(binding.issueId)!==String(incident.incidenceId))return failure('EXACT_ISSUE_BINDING_REQUIRED');
 if(!Number.isFinite(Date.parse(order.createdAt))||messages.some(m=>m.user_ns&&String(m.user_ns)!==conversationId||m.order_id&&String(m.order_id)!==String(order.orderId)))return failure('CONVERSATION_IDENTITY_CONFLICT');
 if(messages.some(m=>isCustomerInteraction(m)&&(!Number.isFinite(messageTimestamp(m))||messageTimestamp(m)>now+1000)))return failure('CUSTOMER_EVENT_TIME_UNVERIFIED');
 const same=previous?.canonical_order_id===canonicalOrderId&&previous.conversation_reference===conversationId&&previous.active_issue_id===(incident?.incidenceId?String(incident.incidenceId):null);
 const state=same?structuredClone(previous):emptyCase({order,incident,conversationId,canonicalOrderId});
 delete state.projection_hash;
 state.updated_at=iso(now);state.current_order_state=order.status;state.current_incident_type=incident?.incidentType||null;state.findings=[];state.asks_status=false;
 const events=[...new Map(messages.filter(m=>messageTimestamp(m)>=Date.parse(order.createdAt)).map(m=>[String(m.id||m.mid||hash(m)),m])).values()].sort((a,b)=>messageTimestamp(a)-messageTimestamp(b)||String(a.id||a.mid).localeCompare(String(b.id||b.mid)));
 let question=null,offer=false,lastInbound=null,confidence=1,latestIntents=[],changeOfMind=0;
 // Rebuild interpretation from the complete bounded transcript: do not retain a
 // superseded intent/slot after an edited source event. Private delivery history
 // and verified actions stay in the persistent state, not in log output.
 const interpreted=emptyCase({order,incident,conversationId,canonicalOrderId});
 for(const event of events){
  const at=messageTimestamp(event),id=String(event.id||event.mid||hash(event));
  if(!isCustomerInteraction(event)){
   if(!extractWamid(event))continue;
   const type=questionContext(event);
   if(/descuento_5/.test(fold(event.payload?.name||'')))offer=true;
   if(type){question=type;interpreted.last_outbound_question_type=type;interpreted.last_outbound_question_at=iso(at);interpreted.last_outbound_message_hash=hash(event.payload?.body||addressMessageText(event));}
   continue;
  }
  const signature=hash([id,at,addressMessageText(event),event.payload?.reply_to_mid]);
  if(state.event_versions[id]!==signature){state.conversation_version++;state.event_versions[id]=signature;}
  // A structured answer must refer to a real outgoing message in THIS transcript.
  const replied=event.payload?.reply_to_mid&&events.find(m=>!isCustomerInteraction(m)&&extractWamid(m)===event.payload.reply_to_mid&&messageTimestamp(m)<at);
  const parsed=interpretMessage(event,{question:replied?questionContext(replied):question,offerVerified:offer,at,incidentType:incident?.incidentType});
  if(interpreted.latest_intent_at===iso(at)&&interpreted.wants_order!==null&&parsed.facts.wants_order!==undefined&&interpreted.wants_order!==parsed.facts.wants_order){parsed.uncertainties.push('SIMULTANEOUS_CONTRADICTORY_EVENTS');parsed.intents.push('AMBIGUOUS');parsed.confidence=0.5;}
  lastInbound=event;
  const meaningful=parsed.intents.some(i=>!['GREETING','THANKS','IRRELEVANT'].includes(i));
  if(meaningful){latestIntents=parsed.intents;confidence=parsed.confidence;interpreted.latest_intent_at=iso(at);}
  if(interpreted.wants_order!==null&&parsed.facts.wants_order!==undefined&&interpreted.wants_order!==parsed.facts.wants_order)changeOfMind++;
  if(parsed.uncertainties?.length){interpreted.unresolved_interpretation=parsed.uncertainties;interpreted.unresolved_at=iso(at);}
  else if(meaningful){interpreted.unresolved_interpretation=[];interpreted.unresolved_at=null;}
  for(const [slot,value]of Object.entries(parsed.facts)){
   if(slot==='address'){
    const prior=interpreted.address,changed=value.street&&prior?.street&&fold(value.street)!==fold(prior.street);
    interpreted.address=changed?value:{...(prior||{}),...Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null&&v!==''))};
    interpreted.address_complete=['street','number','postal_code','city'].every(k=>!!interpreted.address[k]);
   }else if(slot==='address_change_requested'&&at<Date.parse(incident?.incidenceDate||order.createdAt))continue;
   else if(slot!=='address_complete')interpreted[slot]=value;
   interpreted.fact_evidence[slot]={message_id:id,at:iso(at),hash:signature};
  }
  if(parsed.facts.delivery_window){interpreted.time_from=null;interpreted.time_to=null;}
  if(parsed.facts.time_from||parsed.facts.time_to){interpreted.delivery_window=null;}
  state.timeline.push({kind:'CUSTOMER_INTERPRETED',event_hash:signature,at:iso(at),intents:parsed.intents,confidence:parsed.confidence});
 }
 for(const field of Object.keys(interpreted))if(!['clarifications','findings','event_versions','conversation_version','timeline','payment_information_sent','last_verified_action'].includes(field))state[field]=interpreted[field];
 state.updated_at=iso(now);state.latest_customer_at=lastInbound?iso(messageTimestamp(lastInbound)):null;state.latest_customer_event_hash=lastInbound?state.event_versions[String(lastInbound.id||lastInbound.mid||hash(lastInbound))]:null;
 state.latest_customer_intents=latestIntents;state.confidence=confidence;state.change_of_mind_detected=changeOfMind;state.discount_offered=offer;
 state.payment_method=policy.paymentVerified?policy.paymentMethod:null;state.amount_due=policy.paymentVerified&&Number.isFinite(policy.amountDue)?policy.amountDue:null;state.allowed_payment_methods=policy.paymentVerified?(policy.allowedPaymentMethods||[]).filter(m=>['CASH','CARD'].includes(m)):[];
 state.discount_applied_verified=policy.discountAppliedVerified===true;state.address_verified=policy.addressVerified===true;state.last_verified_action=policy.lastVerifiedAction||state.last_verified_action;
 const imported=events.filter(m=>!isCustomerInteraction(m)&&extractWamid(m)&&['DATE','DATE_AND_WINDOW','TIME_WINDOW','WANTS_ORDER','POSTAL_CODE','ADDRESS','LEGACY_PAYMENT'].includes(questionContext(m))).map(m=>({clarification_type:questionContext(m),missing_slots:[],message_hash:hash(m.payload?.body||addressMessageText(m)),sent_at:iso(messageTimestamp(m)),provider_message_id:extractWamid(m),status:'PROVIDER_ACCEPTED',source:'EXISTING_SENDER',answered_at:events.find(n=>isCustomerInteraction(n)&&messageTimestamp(n)>messageTimestamp(m))?iso(messageTimestamp(events.find(n=>isCustomerInteraction(n)&&messageTimestamp(n)>messageTimestamp(m)))):null}));
 const unique=new Map(state.clarifications.map(c=>[c.provider_message_id||c.message_hash,c]));
 for(const observed of imported){
  const pending=[...unique.entries()].find(([,c])=>!c.provider_message_id&&c.source==='CUSTOMER_CARE_EXISTING_SENDER'&&c.message_hash===observed.message_hash&&Math.abs(Date.parse(c.sent_at)-Date.parse(observed.sent_at))<120000);
  const old=unique.get(observed.provider_message_id)||pending?.[1];
  if(pending)unique.delete(pending[0]);
  unique.set(observed.provider_message_id,{...observed,...old,sent_at:observed.sent_at,provider_message_id:observed.provider_message_id,status:observed.status,answered_at:observed.answered_at});
 }
 state.clarifications=[...unique.values()].sort((a,b)=>String(a.sent_at).localeCompare(String(b.sent_at)));
 for(const c of state.clarifications){const answer=events.find(m=>isCustomerInteraction(m)&&messageTimestamp(m)>Date.parse(c.sent_at));if(answer){c.answered_at=iso(messageTimestamp(answer));c.answer_hash=hash(addressMessageText(answer));c.status='ANSWERED';}}
 for(let i=1;i<state.clarifications.length;i++){const a=state.clarifications[i-1],b=state.clarifications[i];if(!a.answered_at||a.answered_at>b.sent_at)state.findings.push({code:'REPEATED_CLARIFICATION',severity:'HIGH',previous_hash:a.message_hash,current_hash:b.message_hash});}
 state.timeline=[...new Map(state.timeline.map(e=>[hash(e),e])).values()].slice(-100);
 // Hash customer/provider evidence, not changing UI counters or pause metadata.
 state.input_hash=hash(events.map(m=>[m.id||m.mid,messageTimestamp(m),isCustomerInteraction(m),m.msg_type,addressMessageText(m),m.payload?.name,m.payload?.body,m.payload?.reply_to_mid,extractWamid(m)]));state.has_current_reply=!!lastInbound&&messageTimestamp(lastInbound)>=Date.parse(incident?.incidenceDate||order.createdAt);
 if(state.delivery_date&&state.delivery_date<madridDate(now)){state.expired_delivery_date=state.delivery_date;state.delivery_date=null;state.delivery_window=null;state.time_from=null;state.time_to=null;}
 return state;
}
