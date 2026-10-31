import {createHash} from 'node:crypto';
import {pickupParameters,PICKUP_TEMPLATE,PICKUP_LANGUAGE,PICKUP_BODY} from '../../autoconfirm/src/workflows/gls-pickup-template.mjs';
import {extractWamid,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
export const PICKUP_STATES=['PICKUP_DETECTED','PICKUP_ELIGIBILITY_CHECK','WAITING_FOR_PICKUP_AVAILABILITY','GLS_LOOKUP_PENDING','GLS_AGENCY_FOUND','GLS_AGENCY_CONFLICT','ORDER_DATA_VERIFIED','WAITING_COD_RECONCILIATION','TEMPLATE_PENDING_APPROVAL','READY_TO_NOTIFY','SEND_CLAIMED','SEND_UNKNOWN','SENT_PROVIDER_ACCEPTED','MESSAGE_VERIFIED','WAITING_CUSTOMER','CLOSED','MANUAL_REVIEW'];
export const PICKUP_SEQUENCE=[{notice:1,enabled:true},{notice:2,enabled:false},{notice:3,enabled:false},{notice:4,enabled:false}];
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const canonicalPickup=r=>r?.issue?.raw?.type==='PICKUP_AT_AGENCY'&&r.issue.raw.carrier==='GLS'&&r.issue.raw.is_active===true&&['PENDING','MANAGING_WITH_CLIENT'].includes(r.issue.raw.status);
export function pickupPlan(input){
 const {order,issue,tracking:t,agency:a,template,subscriber,care,supportReceipt,now=Date.now()}=input;
 const i=issue?.raw,o=order?.raw,id=String(order?.orderId||'');
 const no=(reason,state='MANUAL_REVIEW')=>({eligible:false,order_id:id,issue_id:String(i?.id||''),reason,state,observed_at:new Date(now).toISOString()});
 if(!canonicalPickup(input)||String(i.order_id)!==id)return no('PICKUP_INCIDENT_NOT_ACTIVE','CLOSED');
 if(input.otherActiveIssue)return no('OTHER_ACTIVE_INCIDENT_REQUIRES_REVIEW');
 if(['DELIVERED','RETURNED','CANCELLED','CANCELED'].includes(o.status)||['DELIVERED','RETURNED','CANCELLED','RETURN_IN_TRANSIT','RETURN_REQUESTED'].includes(o.sub_status)||['RETURN_REQUESTED','RETURNED','DELIVERED'].includes(i.resolution_status))return no('SHIPMENT_TERMINAL','CLOSED');
 if(input.priorReturn)return no('PRIOR_RETURN_GUARD');
 const postal=String(o.shipping_address?.postal_code||'');
 if(!['ES','España','Spain'].includes(o.shipping_address?.country)||!/^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(postal))return no('INVALID_SHIPMENT_POSTAL_CODE');
 if(!t?.verified||t.tracking_id!==String(o.tracking_number)||t.postal_code!==postal||String(i.tracking_number)!==String(o.tracking_number)||now-Date.parse(t.observed_at)>60000||now<Date.parse(t.observed_at))return no('FRESH_EXACT_TRACKING_REQUIRED');
 if(['COLLECTED','RETURNED','CANCELLED'].includes(t.state))return no('SHIPMENT_TERMINAL','CLOSED');
 if(t.state!=='READY')return no('WAITING_FOR_PICKUP_AVAILABILITY','WAITING_FOR_PICKUP_AVAILABILITY');
 if(!t.episode_id||!t.agency_code)return no('PICKUP_EPISODE_NOT_VERIFIED');
 if(!a||!['VERIFIED_DIRECTORY_ONLY','VERIFIED_TRACKING_ONLY'].includes(a.validation_status)||a.postal_code_searched!==postal||now-Date.parse(a.retrieved_at)>(a.validation_status==='VERIFIED_TRACKING_ONLY'?60000:24*3600000)||now<Date.parse(a.retrieved_at))return no('MISSING_VERIFIED_AGENCY_DATA');
 if(a.validation_status==='VERIFIED_TRACKING_ONLY'&&(input.allowTrackingFallback!==true||a.source_type!=='GLS_OFFICIAL_TRACKING_VISIBLE'||a.source_url!==o.tracking_url||t.agency!==a))return no('TRACKING_AGENCY_FALLBACK_NOT_VERIFIED');
 if(a.agency_code!==t.agency_code)return no('GLS_AGENCY_CONFLICT','GLS_AGENCY_CONFLICT');
 if(!a.opening_hours||!a.phone||!a.city||!a.province||!a.address_line||!a.agency_name)return no('MISSING_VERIFIED_AGENCY_DATA');
 if(o.payment_method!=='COD'||o.currency!=='EUR'||!Number.isSafeInteger(t.cod_cents)||t.cod_cents<=0)return no('PICKUP_TEMPLATE_PAYMENT_INCOMPATIBLE');
 const total=Math.round(Number(o.total_amount)*100),accepted=care?.discount_response==='ACCEPTED'||care?.latest_customer_intents?.includes('ACCEPTS_DISCOUNT')||input.discountAccepted===true||!!supportReceipt;
 if(!Number.isSafeInteger(total)||total!==t.cod_cents)return no('WAITING_COD_RECONCILIATION','WAITING_COD_RECONCILIATION');
 if(accepted&&(!supportReceipt||supportReceipt.status!=='verified'||Number(supportReceipt.raw?.finalCents)!==total||String(supportReceipt.order_id)!==id))return no('WAITING_COD_RECONCILIATION','WAITING_COD_RECONCILIATION');
 if(!input.exactSubscriber||input.whatsappVerified!==true||!subscriber?.user_ns||!subscriber.subscribed||subscriber.unsubscribed||subscriber.blocked||subscriber.is_blocked)return no('EXACT_SUBSCRIBER_AND_PERMISSION_REQUIRED');
 if(!care?.input_hash)return no('CUSTOMER_CARE_CONTEXT_NOT_VERIFIED');
 if(care?.has_current_reply&&(care.unresolved_interpretation?.length||care.unresolved?.length||care.cancel_intent||care.wants_return||!(care.latest_customer_intents||[]).length||(care.latest_customer_intents||[]).some(x=>!['WANTS_ORDER','REQUESTS_AGENCY','THANKS','GREETING','ACCEPTS_DISCOUNT'].includes(x))))return no('CUSTOMER_CARE_REVIEW_REQUIRED');
 const items=o.line_items;if(!Array.isArray(items)||!items.length||items.some(p=>!p.product_name||!Number.isInteger(Number(p.quantity))||Number(p.quantity)<1))return no('ORDER_PRODUCTS_UNVERIFIED');
 if(!template?.approved)return no('EXACT_TEMPLATE_NOT_APPROVED','TEMPLATE_PENDING_APPROVAL');
 const values={customer_name:o.shipping_address.full_name,order_number:'ES'+id,products:items.map(p=>`${p.product_name} × ${p.quantity}`).join('; '),amount:(total/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'}),agency_name:a.agency_name,address_line:a.address_line,locality:`${a.postal_code} ${a.city}, ${a.province}`,opening_hours:a.opening_hours,phone:a.phone,tracking_url:o.tracking_url};
 let params;try{params=pickupParameters(values);}catch{return no('PICKUP_REQUIRED_PARAMETER_MISSING');}
 const key=`GLS_PICKUP_NOTICE_1:${id}:${t.tracking_id}:${t.episode_id}`;
 return {eligible:true,state:'READY_TO_NOTIFY',reason:'VERIFIED_PICKUP',order_id:id,issue_id:String(i.id),key,tracking_id:t.tracking_id,episode_id:t.episode_id,agency:a,amount_cents:total,tracking:t,template_id:template.id,meta_template_id:template.meta_id,observed_at:new Date(now).toISOString(),conversation_id:subscriber.user_ns,params,payload:{user_ns:subscriber.user_ns,content:{name:PICKUP_TEMPLATE,lang:PICKUP_LANGUAGE,namespace:template.namespace,params}},fingerprint:hash([id,i.id,o,subscriber.user_ns,t.episode_id,t.cod_cents,[a.agency_code,a.source_url,a.source_type],params,template.id,template.meta_id])};
}
export function matchingPickupMessage(messages,plan,{attemptedAt=plan.observed_at,wamid=null}={}){
 const start=Date.parse(attemptedAt)-5000;
 const expected=plan.params;
 const body=PICKUP_BODY.replace(/\{\{(\d+)\}\}/g,(_,n)=>expected[`BODY_{{${n}}}`]);
 const matches=messages.filter(m=>{
  const p=m.payload||m.raw?.payload||{},mid=extractWamid(m),at=messageTimestamp(m);
  const content=Object.entries(expected).every(([k,v])=>p.params?.[k]===v)||p.body===body;
  return String(m.user_ns)===plan.conversation_id&&p.name===PICKUP_TEMPLATE&&(!p.lang||p.lang===PICKUP_LANGUAGE)&&Number.isFinite(at)&&at>=start&&!!mid&&(!wamid||mid===wamid)&&content;
 });return matches.length===1?matches[0]:null;
}
