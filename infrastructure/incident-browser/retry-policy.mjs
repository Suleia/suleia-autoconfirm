import {currentCustomerIntent,deliverySlot,madridDate,resolutionHash} from '../../autoconfirm/src/workflows/incident-intent-v2.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';

export function preciseRetrySlot(text,at){
 const matches=[...text.matchAll(/\bde\s+(\d{1,2})\s*:\s*(\d{2})\s*(?:a|ha|hasta|-)\s*(\d{1,2})\s*:\s*(\d{2})\b/gi)];
 if(matches.length!==1)return deliverySlot(text,at);
 const m=matches[0],start=+m[1]*60 + +m[2],end=+m[3]*60 + +m[4];
 if(+m[2]>59||+m[4]>59||start>=end)return {date:null,time_window:null};
 // Only the owner-approved morning band is generalized here. Other numeric
 // ranges retain the existing conservative parser until carrier mapping exists.
 if(start<8*60||end>14*60)return {date:null,time_window:null};
 return deliverySlot(text.replace(m[0],'por la mañana'),at);
}

export function retryEvidencePlan({incident,order,issue,messages,now=Date.now()}){
 const deny=reason=>({eligible:false,reason});
 const raw=issue?.raw||issue;
 if(!['absent','rejected_goods'].includes(incident.incidentType))return deny('OTHER_WORKFLOW_OWNER');
 if(String(raw?.id)!==String(incident.incidenceId)||String(raw?.order_id)!==String(order?.orderId)||String(order?.orderId)!==String(incident.orderId))return deny('IDENTITY_CONFLICT');
 if(raw.status!=='PENDING'||raw.is_active!==true||raw.resolution_status||!raw.allowed_resolution_options?.includes('RETRY'))return deny('CURRENT_RETRY_NOT_ALLOWED');
 if(!['ERROR','INCIDENCE'].includes(order.status))return deny('ORDER_NOT_IN_INCIDENT');
 const intent=currentCustomerIntent({incident,order,messages,now});
 if(intent.status!=='RESPONDED'||intent.confidence!=='HIGH'||intent.intents.some(x=>!['PROVIDES_DATE','REQUESTS_RETRY','WANTS_ORDER','PROVIDES_TIME_WINDOW'].includes(x)))return deny('REPLY_NOT_UNAMBIGUOUS_RETRY');
 const selected=messages.filter(isCustomerInteraction).filter(m=>messageTimestamp(m)===Date.parse(intent.at));
 if(selected.length!==1)return deny('MESSAGE_IDENTITY_UNCERTAIN');
 const message=selected[0],text=addressMessageText(message),slot=preciseRetrySlot(text,Date.parse(intent.at));
 if(now-Date.parse(intent.at)<3600000)return deny('REPLY_SETTLING_WINDOW');
 if(!slot.date||!slot.time_window)return deny('DATE_OR_WINDOW_REQUIRED');
 if(slot.date<=madridDate(now))return deny('DATE_NOT_FUTURE');
 const phone=String(order.customerPhone||'').replace(/\D/g,'').replace(/^34(?=\d{9}$)/,'');
 if(!/^[67]\d{8}$/.test(phone)||!/^\d+$/.test(String(message.id||'')))return deny('EVIDENCE_IDENTITY_REQUIRED');
 const plan={orderId:String(order.orderId),issueId:String(raw.id),phone,customerName:order.customerName,conversationId:incident.chatbyUserNs,
  messageId:String(message.id),messageAt:intent.at,text,date:slot.date,time_window:slot.time_window};
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
