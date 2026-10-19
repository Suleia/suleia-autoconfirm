import {currentCustomerIntent,deliverySlot,madridDate,resolutionHash} from '../../autoconfirm/src/workflows/incident-intent-v2.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
import {nextBusinessMorning} from './business-day.mjs';

const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
// Only unconditional short confirmations qualify for the owner's default.
// A missing parser result is never permission to discard a requested schedule.
const plainDesire=text=>/^(?:(?:yo|si|pues|claro)[, ]+)*(?:lo quiero|quiero (?:el|mi) pedido|quiero recibirlo)(?:[, ]+(?:por favor|gracias))?[.! ]*$/.test(fold(text));
const preference=text=>/\d|\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|tarde|noche|hoy|dia|hora|semana|mes|antes|despues|hasta|partir|direccion|calle|avenida|portal|piso|puerta|agencia|recoger|llamar|telefono)\b/.test(fold(text));

// Owner-approved missing-date rule: preserve an explicit window only when the
// entire remaining message is an unconditional request to receive the order.
// A factual explanation of a past absence is not a refusal of the new delivery.
export function requestedWindowWithoutDate(text){
 let t=fold(text);
 if(t.length>280)return null;
 const range=numericWindow(t);
 if(range)t=t.replace(range.source,`por la ${range.window==='morning'?'manana':'tarde'}`);
 t=t.replace(/^no (?:me encontraba|estaba) en (?:la )?casa[,. ]+/,'');
 t=t.replace(/^si[, ]+por favor\b/,'por favor');
 const windows=[...t.matchAll(/\b(?:(?:por|en) la )?(manana|tarde)\b/g)];
 if(windows.length!==1)return null;
 // Bare "mañana" is tomorrow, not an unambiguous morning window.
 if(windows[0][0]==='manana')return null;
 t=t.replace(windows[0][0],' ').replace(/\b(?:por favor|gracias)\b/g,' ').replace(/[,.!]/g,' ').replace(/\s+/g,' ').trim();
 t=t.replace(/^(?:si|hola)[, ]*/, '').trim();
 if(!/^(?:(?:yo )?(?:lo quiero|quiero recibirlo|quiero (?:el|mi) pedido)|(?:podrian |pueden )?(?:enviarmelo|entregarmelo)|vuelvan a (?:entregarlo|enviarmelo)|(?:puedo recibirlo|pueden entregarlo|entregar|entrega))?$/.test(t))return null;
 return windows[0][1]==='manana'?'morning':'afternoon';
}

function numericWindow(text){
 const matches=[...text.matchAll(/\b(?:de|entre)\s+(\d{1,2})(?:\s*:\s*(\d{2}))?\s*(?:a|ha|hasta|y|-)\s*(\d{1,2})(?:\s*:\s*(\d{2}))?(?:\s*(?:h|horas))?\b/gi)];
 if(matches.length!==1)return null;
 const m=matches[0],start=+m[1]*60+ +(m[2]||0),end=+m[3]*60+ +(m[4]||0);
 if(+(m[2]||0)>59||+(m[4]||0)>59||start>=end)return null;
 const window=start>=480&&end<=840?'morning':start>=840&&end<=1260?'afternoon':null;
 return window?{source:m[0],window}:null;
}

export function preciseRetrySlot(text,at){
 const range=numericWindow(text);
 // Keep the exact requested range in plan.text and in the uploaded screenshot.
 // Dropea's retry form only offers morning/afternoon, both indicative.
 return deliverySlot(range?text.replace(range.source,range.window==='morning'?'por la mañana':'por la tarde'):text,at);
}

export function retryEvidencePlan({incident,order,issue,messages,now=Date.now()}){
 const deny=reason=>({eligible:false,reason});
 const raw=issue?.raw||issue;
 if(!['absent','rejected_goods'].includes(incident.incidentType))return deny('OTHER_WORKFLOW_OWNER');
 if(String(raw?.id)!==String(incident.incidenceId)||String(raw?.order_id)!==String(order?.orderId)||String(order?.orderId)!==String(incident.orderId))return deny('IDENTITY_CONFLICT');
 if(raw.status!=='PENDING'||raw.is_active!==true||raw.resolution_status||!raw.allowed_resolution_options?.includes('RETRY'))return deny('CURRENT_RETRY_NOT_ALLOWED');
 if(!['ERROR','INCIDENCE'].includes(order.status))return deny('ORDER_NOT_IN_INCIDENT');
 const intent=currentCustomerIntent({incident,order,messages,now});
 if(intent.status!=='RESPONDED')return deny(intent.reason||intent.status||'REPLY_NOT_UNAMBIGUOUS_RETRY');
 const selected=messages.filter(isCustomerInteraction).filter(m=>messageTimestamp(m)===Date.parse(intent.at));
 if(selected.length!==1)return deny('MESSAGE_IDENTITY_UNCERTAIN');
 const message=selected[0],text=addressMessageText(message);
 const requestedWindow=requestedWindowWithoutDate(text);
 if(!requestedWindow&&(intent.confidence!=='HIGH'||intent.intents.some(x=>!['PROVIDES_DATE','REQUESTS_RETRY','WANTS_ORDER','PROVIDES_TIME_WINDOW'].includes(x))))return deny('REPLY_NOT_UNAMBIGUOUS_RETRY');
 let slot=intent.evidence==='VERIFIED_STRUCTURED_BUTTON'?intent.slot:preciseRetrySlot(text,Date.parse(intent.at)),scheduleSource='CUSTOMER_EXPLICIT';
 if(requestedWindow){
  if(now-Date.parse(intent.at)>=24*3600000)return deny('MISSING_DATE_RESPONSE_EXPIRED');
  const anchor=Date.parse(intent.notice_at||incident.incidenceDate);
  const earlier=messages.filter(isCustomerInteraction).filter(m=>messageTimestamp(m)>=anchor&&messageTimestamp(m)<Date.parse(intent.at));
  if(earlier.some(m=>preference(addressMessageText(m))||/descuento|precio|caro|euros|pagar|cancel|devol/.test(fold(addressMessageText(m)))))return deny('PRIOR_CUSTOMER_PREFERENCE_REQUIRES_REVIEW');
  slot=nextBusinessMorning(now,order);
  if(!slot)return deny('BUSINESS_CALENDAR_REQUIRED');
  slot={...slot,time_window:requestedWindow};
  scheduleSource='OWNER_NEXT_BUSINESS_CUSTOMER_WINDOW';
 }else if(!slot.date&&!slot.time_window&&intent.intents.length===1&&intent.intents[0]==='WANTS_ORDER'&&plainDesire(text)){
  const anchor=Date.parse(intent.notice_at||incident.incidenceDate);
  const relevant=messages.filter(isCustomerInteraction).filter(m=>messageTimestamp(m)>=anchor);
  if(relevant.some(m=>preference(addressMessageText(m))))return deny('PRIOR_CUSTOMER_PREFERENCE_REQUIRES_REVIEW');
  slot=nextBusinessMorning(now,order);
  if(!slot)return deny('BUSINESS_CALENDAR_REQUIRED');
  scheduleSource='OWNER_NEXT_BUSINESS_MORNING';
 }
 if(!slot.date||!slot.time_window)return deny('DATE_OR_WINDOW_REQUIRED');
 if(slot.date<=madridDate(now))return deny('DATE_NOT_FUTURE');
 if(now-Date.parse(intent.at)<3600000)return deny('REPLY_SETTLING_WINDOW');
 const phone=String(order.customerPhone||'').replace(/\D/g,'').replace(/^34(?=\d{9}$)/,'');
 if(!/^[67]\d{8}$/.test(phone)||!/^\d+$/.test(String(message.id||'')))return deny('EVIDENCE_IDENTITY_REQUIRED');
 const plan={orderId:String(order.orderId),issueId:String(raw.id),phone,customerName:order.customerName,conversationId:incident.chatbyUserNs,
  messageId:String(message.id),messageAt:intent.at,text,date:slot.date,time_window:slot.time_window,scheduleSource};
 return {eligible:true,...plan,hash:resolutionHash(plan)};
}

export async function executeEvidenceRetry(plan,deps){
 if(!plan?.eligible)return {status:'BLOCKED',reason:plan?.reason||'NO_PLAN'};
 // No provider write before fresh evidence, shared durable reservation and a
 // real screenshot. After any write attempt the reservation is never released.
 const fresh=await deps.revalidate();
 if(!fresh?.eligible||fresh.hash!==plan.hash)return {status:'BLOCKED',reason:'EVIDENCE_CHANGED'};
 const proof=await deps.capture(plan);
 if(!proof?.verified||!proof.path)return {status:'BLOCKED',reason:'PROOF_REQUIRED'};
 const claim=await deps.claim(plan);
 if(!claim?.acquired||claim.persistent!==true)return {status:'RECONCILE',reason:'EXISTING_OR_UNAVAILABLE_CLAIM'};
 const latest=await deps.revalidate();
 if(!latest?.eligible||latest.hash!==plan.hash){await deps.finish('aborted',plan);return {status:'BLOCKED',reason:'LATE_REPLY'};}
 await deps.finish('applied_unverified',plan);
 try{await deps.write(plan,proof);}catch{/* Save may have happened: never resend. */}
 const verified=await deps.verify(plan).catch(()=>false);
 await deps.finish(verified?'verified':'applied_unverified',plan);
 return {status:verified?'VERIFIED':'RECONCILE'};
}
