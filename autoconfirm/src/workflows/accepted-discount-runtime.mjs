import {runAcceptedDiscount} from './accepted-discount-support.mjs';
import {createSupportGmail,gmailSupportConfigured} from '../clients/discount-support-gmail.mjs';
import {captureSupportEvidence,supportCaptureConfigured} from '../clients/discount-support-capture.mjs';
import {readDropeaV2ReturnIssueState} from '../clients/dropea-v2-incidents.mjs';
import {executeDropeaV2Resolution} from '../clients/dropea-v2-issue-actions.mjs';
import {verifyDropeaResolution,buildDropeaResolutionBody} from '../clients/dropea-v2-resolution-contract.mjs';
import {getIncidentChatMessages,loadSubscriberIndex,findSubscriberInIndexForExactOrder} from '../clients/chatby.mjs';
import {getTemplateDelivery,claimTemplateDelivery,finishTemplateDelivery} from '../db/supabase-store.mjs';
import {isSupabaseEnabled,selectRows} from '../clients/supabase.mjs';
import {findVerifiedTemplateDelivery,messageTimestamp,isCustomerInteraction} from './incident-discount-policy.mjs';
import {INCIDENT_DISCOUNT_TEMPLATE_NAME} from './incident-discount-template.mjs';
import {rejectedIntent} from './recipient-rejected-policy.mjs';
import {inspectPriorOrderReturn} from './incident-order-return-guard.mjs';

let running=false,lastRun=null,lastStatus=null;
export function acceptedSupportStatus(env=process.env){
 const missing=[];
 if(!gmailSupportConfigured(env))missing.push('GMAIL_CONNECTION');
 if(!supportCaptureConfigured(env))missing.push('CHATBY_SCREENSHOT_SESSION');
 if(!Number.isFinite(Date.parse(env.DISCOUNT_SUPPORT_ACTIVATION_AT)))missing.push('ACTIVATION_DATE');
 if(!/^[1-9]\d*$/.test(env.DISCOUNT_SUPPORT_DROPSHIPPER_ID||''))missing.push('DROPSHIPPER_ID');
 if(!isSupabaseEnabled())missing.push('PERSISTENT_LEDGER');
 return {enabled:env.DISCOUNT_SUPPORT_ENABLED==='true',ready:missing.length===0,missing,running,lastRun,lastStatus,discountApplication:'SUPPORT_REQUEST_ONLY'};
}
const args=p=>({storeId:'suleia',orderId:p.orderId,templateName:'accepted_discount_support_v1',provider:'gmail_then_dropea',chatbyUserNs:p.conversationId});
const phone=x=>'+'+String(x||'').replace(/\D/g,'');
async function readCandidate(incident,env=process.env){
 const current=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});const issue=current.issue?.raw||current.issue,order=current.order;
 if(String(issue?.id)!==String(incident.incidenceId)||String(issue?.order_id)!==String(incident.orderId)||String(order?.orderId)!==String(incident.orderId))throw Error('CURRENT_IDENTITY_MISMATCH');
 if(String(issue.owner_id)!==env.DISCOUNT_SUPPORT_DROPSHIPPER_ID)throw Error('OWNER_MISMATCH');
 const subscriber=findSubscriberInIndexForExactOrder(await loadSubscriberIndex({force:true}),{phone:order.customerPhone,orderId:order.orderId});
 if(!subscriber||subscriber.user_ns!==incident.chatbyUserNs)throw Error('CONVERSATION_CHANGED');
 const messages=await getIncidentChatMessages(subscriber.user_ns);
 const offer=await getTemplateDelivery({storeId:'suleia',orderId:order.orderId,templateName:INCIDENT_DISCOUNT_TEMPLATE_NAME});
 const delivered=findVerifiedTemplateDelivery(messages,INCIDENT_DISCOUNT_TEMPLATE_NAME);
 if(!offer||offer.status!=='sent'||offer.chatby_user_ns!==subscriber.user_ns||offer.raw?.crossSourceVerified!==true||!delivered||Math.abs(Date.parse(offer.sent_at)-Date.parse(delivered.sentAt))>60000)throw Error('EXACT_OFFER_LEDGER_REQUIRED');
 const offerMessage=messages.find(m=>messageTimestamp(m)===Date.parse(delivered.sentAt)&&!isCustomerInteraction(m)&&JSON.stringify(m).includes(INCIDENT_DISCOUNT_TEMPLATE_NAME));
 const inbound=messages.filter(isCustomerInteraction);if(inbound.some(m=>!Number.isFinite(messageTimestamp(m))||messageTimestamp(m)>Date.now()+60000))throw Error('MESSAGE_TIME_INVALID');
 const acceptance=inbound.filter(m=>messageTimestamp(m)>Date.parse(delivered.sentAt)).sort((a,b)=>messageTimestamp(b)-messageTimestamp(a))[0];
 const prior=await inspectPriorOrderReturn(incident);if(prior.blocked)throw Error('PRIOR_RETURN_UNVERIFIED');
 return {orderId:order.orderId,issueId:String(issue.id),ownerId:String(issue.owner_id),exactOrder:true,readVerified:true,
  customerName:subscriber.name||[subscriber.first_name,subscriber.last_name].filter(Boolean).join(' '),conversationId:subscriber.user_ns,
  phone:phone(order.customerPhone),conversationPhone:phone(subscriber.phone||subscriber.user_id),issueStatus:issue.status,active:issue.is_active,allowed:issue.allowed_resolution_options,
  priorReturn:prior.verified,pickupArranged:Boolean(issue.pickup_point)||/recoger en agencia|recogida en agencia/i.test([issue.resolution_note,issue.initial_carrier_description].filter(Boolean).join(' ')),
  issueAt:issue.created_at,offerAt:delivered.sentAt,acceptedAt:acceptance?new Date(messageTimestamp(acceptance)).toISOString():null,
  intent:rejectedIntent(acceptance?.content||acceptance?.text,{offerVerified:true}).intent,offerVerified:true,offerMessageId:offerMessage?.id,acceptanceMessageId:acceptance?.id,
  originalAmount:offer.raw.originalAmount,offeredAmount:offer.raw.finalAmount,currentAmount:order.orderAmount,currency:order.currencyCode};
}
export async function runAcceptedSupportCycle({env=process.env}={}){
 const state=acceptedSupportStatus(env);if(!state.enabled||!state.ready||running)return state;
 running=true;
 try{
  const rows=await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value,updated_at'},limit:1});const cache=rows[0];
  if(!cache||Date.now()-Date.parse(cache.updated_at)>30*60000)throw Error('INCIDENT_CACHE_STALE');
  const candidates=(cache.value?.incidents||[]).filter(i=>i.incidentDiscountResponseStatus==='DISCOUNT_ACCEPTED'&&i.chatbyUserNs);
  const mail=createSupportGmail({env});
  for(const incident of candidates){
   try {
   const known=await getTemplateDelivery(args({orderId:incident.orderId,conversationId:incident.chatbyUserNs}));if(known)continue;
   const result=await runAcceptedDiscount(incident,{
    ready:()=>acceptedSupportStatus(env).ready,read:i=>readCandidate(i,env),get:p=>getTemplateDelivery(args(p)),
    capture:p=>captureSupportEvidence(p,{env}),claim:p=>claimTemplateDelivery(args(p)),
    save:(p,status,raw)=>finishTemplateDelivery({...args(p),status,attemptedAt:raw.requestedAt,sentAt:status==='verified'?raw.verifiedAt:null,raw}),
    send:(p,a)=>mail.send(p,a),verifyMail:(id,p,a)=>mail.verify(id,p,a),
    solve:p=>executeDropeaV2Resolution(p.issueId,'PROVIDE_SOLUTION',{note:p.solution}),
    verifySolution:async p=>verifyDropeaResolution(await readDropeaV2ReturnIssueState({orderId:p.orderId,incidenceId:p.issueId},{includeOrder:true}),{issueId:p.issueId,orderId:p.orderId,action:'PROVIDE_SOLUTION',body:buildDropeaResolutionBody('PROVIDE_SOLUTION',{note:p.solution})})
   },{activationAt:env.DISCOUNT_SUPPORT_ACTIVATION_AT});
   lastStatus=result.status;
   // One candidate per cycle keeps browser and provider load bounded.
   if(result.mailId||result.status==='RECONCILIATION_REQUIRED')break;
   } catch { lastStatus='CASE_READ_OR_CAPTURE_FAILED'; }
  }
  if(!candidates.length)lastStatus='WAITING_ELIGIBLE_CASE';
 }catch{lastStatus='READ_OR_CONNECTION_FAILED';}
 finally{running=false;lastRun=new Date().toISOString();}
 return acceptedSupportStatus(env);
}
export function startAcceptedSupportScheduler(){
 if(!acceptedSupportStatus().enabled)return;
 const interval=setInterval(()=>{void runAcceptedSupportCycle();},15*60000);interval.unref?.();
 const initial=setTimeout(()=>{void runAcceptedSupportCycle();},120000);initial.unref?.();
}
