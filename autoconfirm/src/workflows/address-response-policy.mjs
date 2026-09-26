import crypto from 'node:crypto';
import {findVerifiedTemplateDelivery,messageTimestamp,isCustomerInteraction,extractWamid} from './incident-discount-policy.mjs';
export const ADDRESS_TEMPLATE='dropea_incidencia_direccion_v1';
export const ADDRESS_POLICY=Object.freeze({id:'ADDRESS_INCORRECT_POLICY_V1',response_policy:'ADDRESS_INCORRECT_RESPONSE_V1',version:'2026-09-26.1',offer_hours:24,return_hours:48,anchor:'REAL_INITIAL_TEMPLATE_SEND',partial_response:'WAIT_DETAILS_THEN_MANUAL_REVIEW',discount_application:'MANUAL_ONLY',owner:'render_incident_automation'});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const iso=x=>Number.isFinite(x)?new Date(x).toISOString():null;
export const addressMessageText=m=>String(m?.payload?.text||m?.text||m?.message||(typeof m?.content==='string'?m.content:m?.content?.text)||m?.content?.body||m?.button_text||m?.raw?.text||m?.raw?.content?.text||'').trim();
function exactAddressNotice(m){
 const name=m?.payload?.name||m?.content?.name||m?.template_name||m?.raw?.payload?.name;
 const slug=norm(name).replace(/^es_es[ _-]+/,'');
 return slug===ADDRESS_TEMPLATE && extractWamid(m) && !isCustomerInteraction(m);
}

export function parseCustomerAddress(text,previous=null){
 const literal=String(text||'').replace(/[\u0000-\u001f]/g,' ').trim(),n=norm(literal);
 const base={kind:'OTHER_RESPONSE',street:null,number:null,floor:null,door:null,postal_code:null,city:null,province:null,reference_notes:null,missing_fields:[]};
 if(!n)return base;
 if(/https?:|\b(?:password|token|contraseña|ignora las instrucciones)\b/.test(n)||literal.length>500)return {...base,kind:'AMBIGUOUS_ADDRESS'};
 if(/\b(?:devolver|ya no lo quiero|no quiero el pedido|no lo quiero)\b/.test(n)&&! /no (?:quiero )?devolver/.test(n))return {...base,kind:'RETURN_REQUEST'};
 if(/recog(?:er|ida).*agencia|prefiero.*agencia/.test(n))return {...base,kind:'AGENCY_REQUEST'};
 if(/quiz[aá]|no se|puede que|o quiza/.test(n))return {...base,kind:'AMBIGUOUS_ADDRESS'};
 const streets=[...literal.matchAll(/\b(?:calle|avenida|avda\.?|plaza|paseo|camino|carretera|ronda|traves[ií]a|urbanizaci[oó]n)\s+([^,;\n]+?)[ ,]+(\d{1,4}[A-Za-z]?|s\/?n)(?=\s|[,.;]|$)/gi)];
 if(streets.length>1)return {...base,kind:'AMBIGUOUS_ADDRESS'};
 const street=streets[0];
 const postal=[...literal.matchAll(/\b(\d{5})\b/g)];
 if(postal.length>1)return {...base,kind:'AMBIGUOUS_ADDRESS'};
 const cp=postal[0];
 const city=cp?literal.slice(cp.index+5).replace(/^[\s,;-]+/,'').split(/[,;.]|\b(?:portal|referencia|al lado|llamar)\b/i)[0].trim():null;
 const fields={...base,street:street?street[0].slice(0,-street[2].length).trim().replace(/,$/,''):null,number:street?.[2]||null,
   floor:literal.match(/\bpiso\s+(\d+[ºª]?)/i)?.[1]||literal.match(/,\s*(\d{1,2})[ºª]?[A-Za-z]\b/)?.[1]||null,door:literal.match(/\bpuerta\s+([A-Za-z0-9]+)/i)?.[1]||literal.match(/,\s*\d{1,2}[ºª]?([A-Za-z])\b/)?.[1]||null,
   postal_code:cp?.[1]||null,city:city&&/^[\p{L}][\p{L}\s'-]+$/u.test(city)?city:null,
   reference_notes:literal.match(/\b(portal azul|segunda puerta|al lado de[^.;]+)/i)?.[0]||null};
 // Only merge a later completion with a single unambiguous partial address;
 // never import absent fields from an unrelated order or an older full address.
 if(!street&&previous?.kind==='INCOMPLETE_ADDRESS'&&cp){fields.street=previous.street;fields.number=previous.number;fields.floor=previous.floor;fields.door=previous.door;fields.reference_notes=previous.reference_notes;}
 if(!fields.street&&!fields.postal_code&&!/\b(calle|avenida|direcci[oó]n|piso|puerta)\b/i.test(literal))return base;
 fields.missing_fields=['street','number','postal_code','city'].filter(k=>!fields[k]);
 if(fields.postal_code&&!/^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(fields.postal_code))return {...fields,kind:'AMBIGUOUS_ADDRESS'};
 fields.kind=fields.missing_fields.length?'INCOMPLETE_ADDRESS':'VALID_ADDRESS';
 return fields;
}

export function addressResponseDecision({incident,messages=[],order=null,now=Date.now(),previous=null}={}){
 const base={policy:ADDRESS_POLICY,policy_snapshot_hash:hash(ADDRESS_POLICY),canonical_issue_id:String(incident?.incidenceId||''),canonical_order_id:String(incident?.orderId||''),conversation_id:incident?.chatbyUserNs||null,template_name:ADDRESS_TEMPLATE,notification_at:null,message_id:null,state:'ADDRESS_ISSUE_DETECTED',intent:'NO_RESPONSE',action:'WAIT_FOR_NOTIFICATION',eligible:false,read_at:iso(now),missing_fields:[],customer_message_present:false};
 const done=extra=>{const d={...base,...extra};const input_snapshot_hash=hash([d.canonical_issue_id,d.canonical_order_id,d.notification_at,d.message_id,d.last_customer_at,d.intent,d.address]);return {...d,input_snapshot_hash,decision_id:hash([input_snapshot_hash,d.policy_snapshot_hash,d.action,d.state]),decision_status:'CURRENT'};};
 if(incident?.incidentType!=='address'||!incident.incidenceId||!incident.orderId||incident.chatbyReadVerified!==true||incident.chatbyOrderAssociation!=='EXACT_ORDER'||!incident.chatbyUserNs)return done({state:'EVIDENCE_UNVERIFIED'});
 if(messages.some(m=>m.user_ns&&String(m.user_ns)!==String(incident.chatbyUserNs)))return done({state:'CONVERSATION_MISMATCH'});
 const opened=Date.parse(incident.incidenceDate);
 const valid=messages.filter(m=>messageTimestamp(m)>=opened&&messageTimestamp(m)<=now);
 const notices=valid.filter(exactAddressNotice).sort((a,b)=>messageTimestamp(a)-messageTimestamp(b));
 const notice=notices[0];if(!notice)return done({state:'INITIAL_TEMPLATE_NOT_OBSERVED'});
 base.notification_at=iso(messageTimestamp(notice));base.message_id=extractWamid(notice);
 base.offer_due_at=iso(messageTimestamp(notice)+24*3600000);base.return_due_at=iso(messageTimestamp(notice)+48*3600000);
 // Preserve the first observed send across retries; never restart deadlines.
 if(previous?.notification_at&&previous.message_id!==base.message_id)return done({state:'NOTIFICATION_CONFLICT',action:'HUMAN_REVIEW'});
 const inbound=messages.filter(isCustomerInteraction);
 if(inbound.some(m=>!Number.isFinite(messageTimestamp(m))||messageTimestamp(m)>now))return done({state:'EVIDENCE_UNVERIFIED',action:'HUMAN_REVIEW'});
 const replies=[...new Map(inbound.filter(m=>messageTimestamp(m)>messageTimestamp(notice)).map(m=>[extractWamid(m)||hash([messageTimestamp(m),addressMessageText(m)]),m])).values()].sort((a,b)=>messageTimestamp(a)-messageTimestamp(b));
 if(replies.some((m,i)=>i&&messageTimestamp(m)===messageTimestamp(replies[i-1])&&addressMessageText(m)!==addressMessageText(replies[i-1])))return done({state:'AMBIGUOUS_MESSAGE_ORDER',action:'HUMAN_REVIEW'});
 let parsed=null;
 const neutral=t=>/^(?:hola[!,. ]*|gracias[!,. ]*|buenos dias[!,. ]*|buenas tardes[!,. ]*|ahora te digo[!,. ]*|[\p{Emoji_Presentation}\s]+)$/u.test(norm(t));
 const offer=findVerifiedTemplateDelivery(valid.filter(m=>messageTimestamp(m)>=messageTimestamp(notice)),'es_es_dropea_incidencia_descuento_5_v1');
 base.discount_offered_at=offer?.sentAt||null;
 let discountAccepted=false;
 for(const m of replies){
   const t=addressMessageText(m);
   if(offer&&messageTimestamp(m)>Date.parse(offer.sentAt)){
     if(/no quiero (?:el )?descuento|sin descuento/i.test(t))discountAccepted=false;
     else if(/quiero el descuento|acepto(?: el descuento)?|ACCEPT_DISCOUNT_5/i.test(t))discountAccepted=true;
   }
   // A greeting does not erase a previously supplied address or return intent.
   if(!neutral(t))parsed=parseCustomerAddress(t,parsed);
 }
 base.discount_accepted=discountAccepted;
 base.customer_message_present=replies.length>0;base.last_customer_at=replies.length?iso(messageTimestamp(replies.at(-1))):null;
 base.response_count=replies.length;
 if(parsed){
   base.intent=parsed.kind;base.address=parsed;base.missing_fields=parsed.missing_fields;
   base.initial_milestones='SUPERSEDED_BY_CUSTOMER_RESPONSE';
   if(discountAccepted&&!['RETURN_REQUEST','AGENCY_REQUEST'].includes(parsed.kind))return done({state:'MANUAL_DISCOUNT_RECOVERY',action:'MANUAL_DISCOUNT_RECOVERY',eligible:false});
   if(parsed.kind==='VALID_ADDRESS'){
     if(String(order?.orderId)!==base.canonical_order_id)return done({state:'PHONE_SOURCE_UNVERIFIED',action:'HUMAN_REVIEW'});
     const phone=String(order.customerPhone||'').replace(/\D/g,'');
     if(!/^(?:34)?[67]\d{8}$/.test(phone))return done({state:'PHONE_SOURCE_UNVERIFIED',action:'HUMAN_REVIEW'});
     const raw=order.raw?.shipping_address||order.raw?.customer||{};
     const original=[raw.address||raw.address1,raw.zip||raw.postal_code,raw.city].filter(Boolean).join(', ');
     const addr=[`${parsed.street} ${parsed.number}`,parsed.floor&&`piso ${parsed.floor}`,parsed.door&&`puerta ${parsed.door}`,`${parsed.postal_code} ${parsed.city}`,parsed.reference_notes].filter(Boolean).join(', ');
     return done({state:'SOLUTION_PREPARED',intent:norm(original)===norm(addr)?'ADDRESS_CONFIRMED':'VALID_ADDRESS',action:'PROVIDE_ADDRESS_SOLUTION',eligible:true,original_address:raw,customer_provided_address:parsed,effective_address_candidate:parsed,solution:`Realizar entrega en ${addr}. Llamar al ${phone}.`});
   }
   if(parsed.kind==='INCOMPLETE_ADDRESS')return done(now-Date.parse(base.last_customer_at)>=24*3600000
     ? {state:'WAITING_DETAILS_MANUAL_REVIEW',action:'HUMAN_REVIEW',eligible:false}
     : {state:'WAITING_CUSTOMER_ADDRESS_DETAILS',action:'ASK_MISSING_FIELDS',eligible:true});
   if(parsed.kind==='RETURN_REQUEST')return done({state:'RETURN_PREPARED',action:'RETURN_TO_ORIGIN',eligible:true});
   if(parsed.kind==='AGENCY_REQUEST')return done({state:'AGENCY_REQUEST',action:'HUMAN_REVIEW'});
   return done({state:'HUMAN_REVIEW_REQUIRED',action:'HUMAN_REVIEW'});
 }
 if(now>=Date.parse(base.return_due_at))return done({state:'RETURN_PREPARED',action:'RETURN_TO_ORIGIN',eligible:true});
 const discount=findVerifiedTemplateDelivery(messages,'es_es_dropea_incidencia_descuento_5_v1');
 if(discount)return done({state:'DISCOUNT_OFFERED',discount_offered_at:discount.sentAt,action:'WAIT_FOR_CUSTOMER'});
 if(now>=Date.parse(base.offer_due_at))return done({state:'DISCOUNT_OFFER_PREPARED',action:'OFFER_5_EURO_DISCOUNT',eligible:true});
 return done({state:'WAITING_CUSTOMER',action:'WAIT_FOR_CUSTOMER'});
}

export function addressStageAllowed(action,incident,env=process.env){
 const stage={PROVIDE_ADDRESS_SOLUTION:'SOLUTION',OFFER_5_EURO_DISCOUNT:'OFFER',RETURN_TO_ORIGIN:'RETURN',ASK_MISSING_FIELDS:'DETAILS'}[action];
 if(!stage||env.ADDRESS_AUTOMATION_ENABLED!=='true'||env[`ADDRESS_${stage}_BREAKER`]==='OPEN')return false;
 const mode=env[`ADDRESS_${stage}_MODE`]||'SHADOW';
 return mode==='LIVE'||mode==='CANARY'&&String(env[`ADDRESS_${stage}_CANARY_ISSUE_ID`]||'')===String(incident.incidenceId);
}

export function addressRuntimeStatus(state,env=process.env){
 const recent=Date.now()-Date.parse(state.lastAddressWorkflowAt)<45*60000;
 return {workflow:'ADDRESS_INCORRECT',owner:'render_incident_automation',observed_at:new Date().toISOString(),last_cycle_at:state.lastAddressWorkflowAt||null,policy:ADDRESS_POLICY,initial_sender:'chatby_native',initial_template:ADDRESS_TEMPLATE,template_id:'1472497',meta_template_id:'3109078812596009',locale:'es_ES',
 stages:{detection:recent?'LIVE':'UNKNOWN',notification:recent&&state.addressWorkflowSummary?.observed>0?'LIVE':'UNKNOWN',interpretation:recent?'SHADOW':'UNKNOWN',decision:recent?'SHADOW':'UNKNOWN',...Object.fromEntries(['SOLUTION','OFFER','RETURN','DETAILS'].map(s=>[s.toLowerCase(),env.ADDRESS_AUTOMATION_ENABLED==='true'?(env[`ADDRESS_${s}_MODE`]||'SHADOW'):'SHADOW']))},
 breakers:Object.fromEntries(['SOLUTION','OFFER','RETURN','DETAILS'].map(s=>[s.toLowerCase(),env[`ADDRESS_${s}_BREAKER`]==='OPEN'?'OPEN':'CLOSED'])),summary:state.addressWorkflowSummary||null,discount_application:'MANUAL_ONLY'};
}
