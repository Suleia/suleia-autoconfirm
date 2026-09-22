import crypto from 'node:crypto';
import { absentHash } from './absent-template.mjs';
import { interpretAbsentResponse, madridDay, addDays } from './recipient-absent-policy.mjs';

export const ABSENT_RESOLUTION_POLICY = 'RECIPIENT_ABSENT_RESOLUTION_V1';
const actionableOrderStates = new Set(['IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','INCIDENCE']);
export const resolutionFresh = (at, now, seconds = 15) => Boolean(at) && Number.isFinite(Date.parse(at)) && Date.parse(at)<=+new Date(now) && +new Date(now)-Date.parse(at)<=seconds*1000;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '');

// Only a fresh GET of this exact provider order may create this provenance.
// Missing/invalid canonical data is not replaced by another customer's number.
export function verifiedAbsentOrderPhone({ issue, providerOrder, observedAt, privacyKey }) {
  const invalid = { verified:false, canonical_order_id:issue?.canonical_order_id, reason_code:'ORDER_PHONE_NOT_VERIFIABLE' };
  if (!issue?.canonical_order_id || String(providerOrder?.id)!==String(issue.dropea_order_id)
    || String(providerOrder?.store_id)!==String(issue.store_id) || !privacyKey || privacyKey.length<32) return invalid;
  const sources = [['order.customer_phone',providerOrder.customer_phone],['order.shipping_address.phone_number',providerOrder.shipping_address?.phone_number],['order.customer.phone',providerOrder.customer?.phone]];
  const found=sources.find(([,value])=>value!==null && value!==undefined && String(value).trim());
  if(!found)return invalid;
  const raw=String(found[1]).trim();
  if(!/^\+?[\d ()-]+$/.test(raw))return invalid;
  let number=raw.replace(/[ ()-]/g,'');
  if(number.startsWith('00'))number='+'+number.slice(2);
  // Spain's country code is added only with explicit order shipping country.
  if(/^[6789]\d{8}$/.test(number) && ['ES','ESP','SPAIN','ESPAÑA'].includes(String(providerOrder.shipping_address?.country || '').toUpperCase()))number='+34'+number;
  if(!/^\+[1-9]\d{7,14}$/.test(number))return invalid;
  if(number.startsWith('+34') && !/^\+34[6789]\d{8}$/.test(number))return invalid;
  return { verified:true, canonical_order_id:issue.canonical_order_id, value:number, source:found[0], observed_at:observedAt,
    phone_hash:crypto.createHmac('sha256',privacyKey).update(number).digest('hex'), masked:`••••${number.slice(-4)}` };
}

// A later unclear message is a blocker, never permission to fall back to an
// earlier convenient response. Previous dates are inherited only in this case.
export function selectRecipientAbsentIntent({ issue={}, order={}, events=[], chatby={}, now=new Date() }={}) {
  const reasons=[];
  if(!issue.canonical_issue_id || issue.canonical_order_id!==order.canonical_order_id || !['EXACT','VERIFIED'].includes(order.identity_status))reasons.push('EXACT_ORDER_IDENTITY_REQUIRED');
  if(chatby.verified!==true || chatby.history_complete!==true || !chatby.notification_message_id
    || !chatby.template_contact_verified || !chatby.chatby_conversation_id_hash || !chatby.chatby_contact_id_hash
    || !chatby.incident_notified_at || Date.parse(chatby.incident_notified_at)<Date.parse(issue.created_at))reasons.push('EXACT_CURRENT_CHATBY_REQUIRED');
  const inbound=events.filter(e=>e.canonical_issue_id===issue.canonical_issue_id && e.canonical_order_id===order.canonical_order_id
    && e.direction==='INBOUND' && e.relevance_status==='CURRENT_ORDER_EXACT_MATCH'
    && Date.parse(e.created_at)>Date.parse(chatby.incident_notified_at) && Date.parse(e.created_at)<=+new Date(now));
  const unique=new Map();
  for(const e of inbound){
    if(!e.chatby_message_id || e.provider_message_id_verified===false){reasons.push('CUSTOMER_MESSAGE_ID_MISSING');continue;}
    if(unique.has(e.chatby_message_id) && absentHash(unique.get(e.chatby_message_id))!==absentHash(e))reasons.push('CHATBY_EVENT_ID_CONTENT_CONFLICT');
    unique.set(e.chatby_message_id,e);
  }
  const scoped=[...unique.values()].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.chatby_message_id.localeCompare(b.chatby_message_id));
  let previous=null, latest=null, response=null, supersedes=null;
  for(const event of scoped){
    const correlated=event.chatby_conversation_id_hash===chatby.chatby_conversation_id_hash && event.chatby_contact_id_hash===chatby.chatby_contact_id_hash;
    if(!correlated)reasons.push('EXACT_CURRENT_CHATBY_REQUIRED');
    const current=interpretAbsentResponse({...event,correlated_requested_date:correlated && previous?.response.unambiguous ? previous.response.requested_date:null});
    if(latest && Date.parse(event.created_at)===Date.parse(latest.created_at)
      && absentHash([current.customer_intent,current.requested_date,current.requested_time_window,current.time_from,current.time_to])!==absentHash([response.customer_intent,response.requested_date,response.requested_time_window,response.time_from,response.time_to]))reasons.push('CONFLICTING_SIMULTANEOUS_RESPONSES');
    supersedes=previous?.event.chatby_message_id || null;
    latest=event;response=current;
    previous=current.unambiguous && correlated ? {event,response:current}:null;
  }
  if(!latest)reasons.push('NO_VALID_CUSTOMER_RESPONSE');
  if(response && !response.unambiguous)reasons.push(response.reason_code);
  const evidence={verified:reasons.length===0, canonical_issue_id:issue.canonical_issue_id,canonical_order_id:order.canonical_order_id,
    response_id:latest?.chatby_message_id || null,response_hash:response?.raw_customer_text_hash || null,source_message_id:latest?.chatby_message_id || null,
    button_id:latest?.button_payload || null, source:response?.interpretation_source || null, response_at:latest?.created_at || null,
    notification_at:chatby.incident_notified_at,observed_at:chatby.observed_at,supersedes_response_id:supersedes,
    unambiguous:response?.unambiguous===true, latest:true};
  return {response:response || {customer_intent:'UNKNOWN',confidence:0},evidence,blocking_reasons:[...new Set(reasons)]};
}

export function buildRecipientAbsentResolution(input={}) {
  const {canonical_issue_id,canonical_order_id,customer_intent,requested_date,requested_time_window,time_from=null,time_to=null,
    verified_phone:phone={},interpretation_confidence=0,evidence_source:evidence={},logistics_capability:cap={},now=new Date()}=input;
  const reasons=[...(input.blocking_reasons || [])];
  if(!canonical_issue_id || !canonical_order_id || evidence.canonical_issue_id!==canonical_issue_id || evidence.canonical_order_id!==canonical_order_id)reasons.push('EXACT_ORDER_IDENTITY_REQUIRED');
  if(customer_intent!=='RESCHEDULE_DELIVERY' || evidence.verified!==true || evidence.unambiguous!==true || !evidence.response_id
    || evidence.latest!==true || !['FREE_TEXT','VERIFIED_BUTTON'].includes(evidence.source)
    || !Number.isFinite(Date.parse(evidence.response_at)) || !(Date.parse(evidence.response_at)>Date.parse(evidence.notification_at)))reasons.push('CUSTOMER_INTENT_NOT_UNAMBIGUOUS');
  if(!phone.verified || phone.canonical_order_id!==canonical_order_id || !/^\+[1-9]\d{7,14}$/.test(phone.value || '') || !phone.phone_hash || !phone.source)reasons.push('ORDER_PHONE_NOT_VERIFIABLE');
  if(!validDate(requested_date) || requested_date<madridDay(now))reasons.push('AMBIGUOUS_DELIVERY_DATE');
  if(cap.verified!==true || cap.canonical_issue_id!==canonical_issue_id || cap.canonical_order_id!==canonical_order_id
    || cap.action!=='PROVIDE_SOLUTION' || !cap.contract_hash
    || requested_time_window && !cap.supported_windows?.includes(requested_time_window))reasons.push('PROVIDE_SOLUTION_CAPABILITY_NOT_VERIFIED');
  if(cap.requires_window && ['UNSPECIFIED','DATE_ONLY','ALL_DAY'].includes(requested_time_window))reasons.push('DELIVERY_TIME_WINDOW_REQUIRED');
  if(!['MORNING','AFTERNOON','ALL_DAY','UNSPECIFIED','DATE_ONLY','TIME_RANGE','FROM_TIME','UNTIL_TIME'].includes(requested_time_window))reasons.push('DELIVERY_TIME_WINDOW_REQUIRED');
  if(['TIME_RANGE','FROM_TIME'].includes(requested_time_window) && !validTime(time_from)
    || ['TIME_RANGE','UNTIL_TIME'].includes(requested_time_window) && !validTime(time_to)
    || requested_time_window==='TIME_RANGE' && time_from>=time_to
    || requested_time_window==='UNTIL_TIME' && time_from!==null
    || requested_time_window==='FROM_TIME' && time_to!==null
    || ['MORNING','AFTERNOON','ALL_DAY','UNSPECIFIED','DATE_ONLY'].includes(requested_time_window) && (time_from!==null || time_to!==null))reasons.push('INVALID_DELIVERY_TIME_WINDOW');
  const structured={canonical_issue_id,canonical_order_id,customer_intent,requested_date,requested_time_window,time_from,time_to,
    timezone:'Europe/Madrid',resolved_at:evidence.response_at || null,source_message_id:evidence.source_message_id || null,button_id:evidence.button_id || null,
    interpretation_confidence,interpretation_source:evidence.source || null,supersedes_response_id:evidence.supersedes_response_id || null,
    latest_valid_customer_intent:customer_intent,phone_source:phone.source || null,phone_hash:phone.phone_hash || null,phone_masked:phone.masked || null,
    response_hash:evidence.response_hash || null,policy_version:ABSENT_RESOLUTION_POLICY};
  let text=null;
  if(!reasons.length){
    const tomorrow=addDays(madridDay(now),1);
    const date=requested_date===tomorrow ? '' : ` el ${requested_date.split('-').reverse().join('/')}`;
    const slot={MORNING:' por la mañana',AFTERNOON:' por la tarde',ALL_DAY:' durante el día',UNSPECIFIED:'',DATE_ONLY:'',TIME_RANGE:` entre las ${time_from} y las ${time_to}`,FROM_TIME:` a partir de las ${time_from}`,UNTIL_TIME:` antes de las ${time_to}`}[requested_time_window];
    const dateOnly=['ALL_DAY','UNSPECIFIED','DATE_ONLY'].includes(requested_time_window);
    text=`Realizar entrega${date || (dateOnly?' mañana':'')}${slot} y por favor, llamar al número de teléfono ${phone.value}`;
    if(text.length>500)reasons.push('RESOLUTION_TOO_LONG');
  }
  const hash=text?absentHash([text,requested_date,requested_time_window,time_from,time_to]):null;
  return {resolution_text:reasons.length?null:text,resolution_structured:structured,can_execute:reasons.length===0,blocking_reasons:[...new Set(reasons)],
    resolution_hash:hash,idempotency_key:hash?absentHash([canonical_issue_id,evidence.response_id,hash]):null};
}

export function absentResolutionPreflight(input, now=new Date()) {
  const {issue={},order={},chatby={},verified_phone={},logistics_capability={}}=input;
  const selected=selectRecipientAbsentIntent({...input,now});
  const reasons=[...selected.blocking_reasons];
  if(input.decision_currentness && input.decision_currentness!=='CURRENT')reasons.push('DECISION_NOT_CURRENT');
  if(input.return_in_progress===true)reasons.push('INCOMPATIBLE_RETURN_IN_PROGRESS');
  if(issue.type!=='RECIPIENT_ABSENT' || issue.status!=='PENDING' || issue.is_active!==true || !actionableOrderStates.has(order.canonical_state))reasons.push('INCIDENT_NOT_ACTIONABLE');
  if(issue.resolution_status || issue.resolution_changed_at || input.later_action_exists)reasons.push('LATER_ACTION_ALREADY_EXISTS');
  for(const at of [issue.observed_at,order.observed_at,chatby.observed_at,verified_phone.observed_at,logistics_capability.observed_at])if(!resolutionFresh(at,now))reasons.push('RESOLUTION_DATA_NOT_FRESH');
  const response=selected.response;
  const result=buildRecipientAbsentResolution({canonical_issue_id:issue.canonical_issue_id,canonical_order_id:order.canonical_order_id,
    ...response,interpretation_confidence:response.confidence,verified_phone,evidence_source:selected.evidence,logistics_capability,blocking_reasons:reasons,now});
  return {...result,execution_freshness:{status:reasons.includes('RESOLUTION_DATA_NOT_FRESH')?'REVALIDATION_REQUIRED':'FRESH',checked_at:new Date(now).toISOString()},decision_currentness:input.decision_currentness || 'NOT_VERIFIED'};
}

const reasonLabels={ORDER_PHONE_NOT_VERIFIABLE:'Teléfono del pedido no verificable',AMBIGUOUS_DELIVERY_DATE:'Fecha de entrega no inequívoca.',
  REQUESTED_DATE_MISSING:'Fecha de entrega no inequívoca.',REQUESTED_DATE_IN_PAST:'La fecha solicitada ya ha pasado.',NEGATED_TIME_WINDOW:'El cliente ha rechazado esa franja.',
  AMBIGUOUS_CUSTOMER_RESPONSE:'Preferencia del cliente ambigua.',CUSTOMER_INTENT_NOT_UNAMBIGUOUS:'Preferencia del cliente no inequívoca.',
  PROVIDE_SOLUTION_CAPABILITY_NOT_VERIFIED:'Dropea no permite aportar esta solución.',DELIVERY_TIME_WINDOW_REQUIRED:'Falta una franja admitida por el proveedor.',
  RESOLUTION_DATA_NOT_FRESH:'Es necesario actualizar los datos antes de actuar.',INCIDENT_NOT_ACTIONABLE:'La incidencia ya no está pendiente y activa.',
  EXACT_CURRENT_CHATBY_REQUIRED:'Conversación o aviso AUSENTE no verificable para este pedido.',NO_VALID_CUSTOMER_RESPONSE:'No hay respuesta válida posterior al aviso.',
  EXACT_ORDER_IDENTITY_REQUIRED:'Pedido e incidencia no coinciden.',CONFLICTING_SIMULTANEOUS_RESPONSES:'Hay respuestas incompatibles sin orden verificable.',
  WRITE_PERMISSION_NOT_AVAILABLE:'Falta el permiso de escritura en Dropea.',ABSENT_RESOLUTION_LIVE_DISABLED:'Resolución automática pendiente de activación.',
  LATER_ACTION_ALREADY_EXISTS:'Ya existe una acción posterior.',PROVIDER_RESULT_UNVERIFIED:'Resultado del envío no verificable; revisar antes de repetir.'};
export function recipientAbsentResolutionPanel(resolution, execution=null, runtimeBlockers=[]) {
  const s=resolution.resolution_structured;
  const applied=execution?.status==='APPLIED' && execution.idempotency_key===resolution.idempotency_key;
  const reasons=[...new Set([...resolution.blocking_reasons,...runtimeBlockers])];
  const slots={MORNING:'Mañana',AFTERNOON:'Tarde',ALL_DAY:'Todo el día',UNSPECIFIED:'No indicada',DATE_ONLY:'No indicada',FROM_TIME:`Desde ${s.time_from}`,UNTIL_TIME:`Hasta ${s.time_to}`,TIME_RANGE:`${s.time_from}–${s.time_to}`};
  const label=s.requested_time_window==='MORNING'?'por la mañana':s.requested_time_window==='AFTERNOON'?'por la tarde':'en la fecha y franja indicadas';
  return {status:applied?'SOLUTION_PROVIDED':reasons.length?'HUMAN_REVIEW_REQUIRED':'READY_FOR_RESOLUTION',
    title:applied?'Solución aportada':reasons.length?'Revisión humana':'Solución preparada',
    next_action:applied?`Nueva entrega ${label}`:reasons.length?'Revisar preferencia del cliente':`Aportar solución: nueva entrega ${label}`,
    detail:applied?`Se solicitó entrega ${label} con llamada previa.`:[...new Set(reasons.map(r=>reasonLabels[r] || 'Requiere comprobación manual.'))].slice(0,3).join(' '),
    interpretation:s.customer_intent==='RESCHEDULE_DELIVERY'?'Nueva entrega':'Ambigua',requested_date:s.requested_date || null,
    window:slots[s.requested_time_window] || 'No indicada',phone:s.phone_masked || 'Teléfono del pedido no verificable',
    evidence:s.interpretation_source==='VERIFIED_BUTTON'?'Botón Chatby verificado':'Texto del cliente',blocking_reasons:reasons,
    structured:s,resolution_hash:resolution.resolution_hash,idempotency_key:resolution.idempotency_key};
}
