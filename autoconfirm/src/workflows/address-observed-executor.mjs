import {addressResponseDecision,addressStageAllowed} from './address-response-policy.mjs';
import {readDropeaV2ReturnIssueState} from '../clients/dropea-v2-incidents.mjs';
import {provideDropeaV2AddressSolution} from '../clients/dropea-v2-issue-actions.mjs';
import {getIncidentChatMessages,sendTextMessage} from '../clients/chatby.mjs';
import {claimIncidentAddressResolution,finishIncidentAddressResolution,claimTemplateDelivery,finishTemplateDelivery} from '../db/supabase-store.mjs';
import {inspectPriorOrderReturn} from './incident-order-return-guard.mjs';
import {extractWamid} from './incident-discount-policy.mjs';
import {createHash} from 'node:crypto';

export async function executeObservedAddress(incident,expected,{env=process.env,readCurrent=readDropeaV2ReturnIssueState,readMessages=getIncidentChatMessages,claim=claimIncidentAddressResolution,finish=finishIncidentAddressResolution,write=provideDropeaV2AddressSolution,prior=inspectPriorOrderReturn,claimMessage=claimTemplateDelivery,finishMessage=finishTemplateDelivery,send=sendTextMessage}={}){
 if(!addressStageAllowed(expected.action,incident,env))return {status:'SHADOW',verified:false};
 const current=await readCurrent(incident,{includeOrder:true}).catch(()=>null);
 const issue=current?.issue?.raw||current?.issue;
 if(!issue||String(issue.id)!==String(incident.incidenceId)||String(issue.order_id)!==String(incident.orderId)||issue.type!=='ADDRESS_INCORRECT'||issue.status!=='PENDING'||issue.is_active!==true||String(current.order?.orderId)!==String(incident.orderId)||!['ERROR','INCIDENCE'].includes(current.order?.status))return {status:'BLOCKED_CURRENT_ISSUE',verified:false};
 if(!incident.phone||String(current.order.customerPhone||'').replace(/\D/g,'').slice(-9)!==String(incident.phone).replace(/\D/g,'').slice(-9))return {status:'BLOCKED_ORDER_PHONE_CHANGED',verified:false};
 const old=await prior(incident).catch(()=>({blocked:true}));if(old.verified||old.blocked)return {status:'BLOCKED_PRIOR_RETURN',verified:false};
 const messages=await readMessages(incident.chatbyUserNs).catch(()=>null);if(!messages)return {status:'BLOCKED_CHATBY_READ',verified:false};
 const d=addressResponseDecision({incident,messages,order:current.order,previous:expected});
 if(!d.eligible||d.action!==expected.action||d.message_id!==expected.message_id)return {status:'SUPERSEDED_BY_CURRENT_RESPONSE',verified:false};
 const key={storeId:'suleia',orderId:incident.orderId,incidenceId:incident.incidenceId};
 if(d.action==='ASK_MISSING_FIELDS'){
   // Reply-window eligibility: only a fresh customer message may trigger text.
   if(Date.now()-Date.parse(d.last_customer_at)>=24*3600000)return {status:'WAITING_DETAILS_MANUAL_REVIEW',verified:false};
   const names={street:'calle',number:'número',postal_code:'código postal',city:'localidad'};
   const content=`Para completar la dirección de tu pedido, indícanos: ${d.missing_fields.map(k=>names[k]).join(', ')}. Gracias.`;
   const args={...key,templateName:`address_missing_fields_v1:${incident.incidenceId}:${d.missing_fields.join('_')}`,provider:'chatby',chatbyUserNs:incident.chatbyUserNs,customerPhone:''};
   const c=await claimMessage(args);if(!c?.acquired||c.persistent!==true)return {status:'DETAILS_REQUEST_ALREADY_CLAIMED',verified:false,last_required_field_request_at:c?.existing?.sent_at||null};
   const at=new Date().toISOString();let result;
   const fresh=await readMessages(incident.chatbyUserNs).catch(()=>null);
   const currentDecision=fresh?addressResponseDecision({incident,messages:fresh,order:current.order,previous:expected}):null;
   if(!currentDecision?.eligible||currentDecision.action!==d.action||currentDecision.input_snapshot_hash!==d.input_snapshot_hash){
     await finishMessage({...args,status:'aborted',attemptedAt:at,raw:{reason:'LATE_CUSTOMER_RESPONSE'}});
     return {status:'SUPERSEDED_BY_CURRENT_RESPONSE',verified:false};
   }
   try{const response=await send({user_ns:incident.chatbyUserNs,content});const mid=extractWamid(response);result={status:mid?'DETAILS_REQUEST_SENT':'EXECUTION_UNKNOWN',verified:!!mid,last_required_field_request_at:mid?at:null,message_id:mid};}
   catch{result={status:'EXECUTION_UNKNOWN',verified:false};}
   await finishMessage({...args,status:result.verified?'sent':'delivery_unverified',attemptedAt:at,sentAt:result.verified?at:null,raw:{workflow:'ADDRESS_INCORRECT',...result}});
   return result;
 }
 // Capability name and resulting resolution status are distinct V2 enums.
 if(d.action!=='PROVIDE_ADDRESS_SOLUTION'||!issue.allowed_resolution_options?.includes('PROVIDE_SOLUTION'))return {status:'BLOCKED_SOLUTION_CAPABILITY',verified:false};
 const c=await claim(key);if(!c?.acquired||c.persistent!==true)return {status:'ALREADY_CLAIMED_RECONCILE',verified:false};
 const at=new Date().toISOString();
 // Recheck after the durable reservation so a late cancellation wins.
 const finalMessages=await readMessages(incident.chatbyUserNs).catch(()=>null);
 const last=finalMessages?addressResponseDecision({incident,messages:finalMessages,order:current.order,previous:expected}):null;
 if(!last?.eligible||last.action!==d.action||last.input_snapshot_hash!==d.input_snapshot_hash){await finish({...key,status:'aborted',attemptedAt:at,evidence:{reason:'LATE_RESPONSE'}});return {status:'SUPERSEDED_BY_CURRENT_RESPONSE',verified:false};}
 let receipt=false;
 try{await write(incident.incidenceId,last.solution,{idempotencyNonce:`address-${incident.incidenceId}`});receipt=true;}catch{/* Reconcile; never automatically resend an uncertain action. */}
 const after=await readCurrent(incident).catch(()=>null),applied=after?.issue?.raw||after?.issue;
 const verified=String(applied?.id)===String(incident.incidenceId)&&String(applied?.order_id)===String(incident.orderId)&&applied.status==='RESOLVED'&&applied.resolution_status==='SOLUTION_PROVIDED';
 const result={status:verified?'ADDRESS_SOLUTION_VERIFIED':'EXECUTION_UNKNOWN',verified,provider_receipt:receipt,attempted_at:at,verified_at:verified?new Date().toISOString():null};
 await finish({...key,status:verified?'verified':'applied_unverified',attemptedAt:at,completedAt:result.verified_at,evidence:{...result,policy_id:d.policy.id,input_snapshot_hash:last.input_snapshot_hash,solution_hash:createHash('sha256').update(last.solution).digest('hex'),decision_id:last.decision_id}});
 return result;
}
