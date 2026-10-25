import {randomUUID} from 'node:crypto';
import {REMINDER_TEMPLATE,REMINDER_LOCALE,REMINDER_OWNER,REMINDER_COMPONENT_HASH,reminderKey,reminderHash,approvedReminder,evaluateReminder,initialProof,reminderParameters,providerTemplate,messageAt,exactPhone,confirmationOrderField,numericId} from './order-reminder-policy.mjs';

const safeCode=error=>/^[A-Z][A-Z0-9_]{2,90}$/.test(error?.code||'')?error.code:'REMINDER_DEPENDENCY_UNAVAILABLE';
export function renderedReminder(template,params){
 const components=typeof template.components==='string'?JSON.parse(template.components):template.components;
 return components.find(c=>c.type==='BODY').text.replace(/\{\{(\d+)\}\}/g,(_,n)=>params[`BODY_{{${n}}}`]);
}
export function verifyReminderReadback(context,receipt){
 const {subscriber,messages=[],historyComplete}=context;
 if(!historyComplete||!subscriber||confirmationOrderField(subscriber)!==numericId(receipt.dropea_order_id)
  ||reminderHash(exactPhone(subscriber.phone||subscriber.user_id))!==receipt.recipient_hash
  ||reminderHash(String(subscriber.user_ns))!==receipt.conversation_hash)return null;
 const matches=messages.filter(m=>m.type==='out'&&String(m.mid||'').startsWith('wamid.')
  &&providerTemplate(m)===REMINDER_TEMPLATE&&String(m.user_ns)===String(subscriber.user_ns)
  &&messageAt(m)>=Math.floor(Date.parse(receipt.send_started_at)/1000)*1000
  &&(!receipt.provider_message_id||m.mid===receipt.provider_message_id)
  &&typeof m.payload?.body==='string'&&reminderHash(m.payload.body)===receipt.rendered_body_hash);
 return matches.length===1?matches[0]:null;
}
export function createOrderReminderService({ports,config,now=Date.now}){
 let running=false;
 const mode=()=>config.realSends?'LIVE':config.canaryEnabled?'CANARY':'SHADOW';
 const senderReady=()=>config.owner===REMINDER_OWNER&&config.nativeSendersDisabled===true&&Boolean(config.ownerReference);
 const base=order=>({canonical_order_id:order.canonicalOrderId,dropea_order_id:String(order.orderId),template_name:REMINDER_TEMPLATE,template_locale:REMINDER_LOCALE});
 async function process(order,{replay=false,allowSend=false}={}){
  const key=reminderKey(order.canonicalOrderId);
  let delivery=await ports.delivery.get(key);
  if(delivery&&['CLAIMED','SENDING','SEND_UNKNOWN'].includes(delivery.status)){
   if(!delivery.raw?.send_started_at)return {state:'REMINDER_ALREADY_SENT',reason:'CLAIM_REQUIRES_RECONCILIATION'};
   if(delivery.raw.component_hash!==REMINDER_COMPONENT_HASH||delivery.raw.owner_reference!==config.ownerReference)return {state:'REMINDER_ALREADY_SENT',reason:'DIFFERENT_DELIVERY_CONTRACT_REQUIRES_REVIEW'};
   const context=await ports.readContext(order),seen=verifyReminderReadback(context,delivery.raw);
   if(seen){if(!replay&&!await ports.delivery.finish(key,delivery.raw.claim_id,'VERIFIED',{...delivery.raw,send_status:'VERIFIED',provider_message_id:seen.mid,verified_at:new Date(now()).toISOString()}))return {state:'SEND_UNKNOWN',reason:'REMINDER_LEDGER_VERIFICATION_UNCERTAIN'};return {state:'REMINDER_ALREADY_SENT',reason:'VERIFIED',reconciled:true,providerMessageId:seen.mid};}
   return {state:'REMINDER_ALREADY_SENT',reason:'SEND_UNKNOWN'};
  }
  if(delivery?.status==='VERIFIED'||delivery?.status==='SEND_REJECTED')return {state:'REMINDER_ALREADY_SENT',reason:delivery.status};
  const context=await ports.readContext(order);context.delivery=delivery;
  let decision=evaluateReminder(context,{now:now(),lookbackHours:config.lookbackHours});
  const proof=initialProof(context);
  decision={...decision,initialVerified:Boolean(proof),customerActivityObserved:proof&&context.historyComplete===true?context.messages.some(m=>m.type==='in'&&messageAt(m)>=proof.sentMs):null,confirmedBeforeTwoHours:Boolean(decision.confirmedAtCheck&&Number.isFinite(Date.parse(decision.confirmedAtCheck))&&Date.parse(decision.confirmedAtCheck)>=Date.parse(decision.createdAt)&&Date.parse(decision.confirmedAtCheck)<=Date.parse(decision.dueAt))};
  if(decision.state!=='ELIGIBLE'||replay||!allowSend)return decision;
  if(!senderReady())return {...decision,state:'SENDER_NOT_VERIFIED',reason:'REMINDER_SINGLE_SENDER_UNVERIFIED'};
  const template=await ports.readTemplate();
  if(!approvedReminder(template))return {...decision,state:'TEMPLATE_NOT_APPROVED',reason:'REMINDER_TEMPLATE_CONTRACT_CHANGED'};
  const claimId=randomUUID();
  const receipt={...base(order),initial_template_sent_at:decision.initialTemplateSentAt,due_at:decision.dueAt,eligibility_checked_at:new Date(now()).toISOString(),customer_activity_after_initial:false,confirmed_at_check:null,claim_id:claimId,send_started_at:null,provider_message_id:null,send_status:'CLAIMED',verified_at:null,block_reason:null,component_hash:REMINDER_COMPONENT_HASH,owner_reference:config.ownerReference,initial_message_hash:reminderHash(decision.initialMessageId)};
  const claim=await ports.delivery.claim(key,receipt);
  if(!claim.acquired||!claim.persistent)return {state:'REMINDER_ALREADY_SENT',reason:'PERSISTENT_CLAIM_NOT_ACQUIRED'};
  // No POST has started. A failed final read is explicitly different from an
  // uncertain message send. Only this pre-send state can ever be reclaimed.
  try{
   // Catalogue waits share the provider queue with existing workflows. Read it
   // before the final conversation so it cannot age that evidence afterwards.
   const finalTemplate=await ports.readTemplate();
   if(!approvedReminder(finalTemplate))throw Object.assign(Error(),{code:'REMINDER_TEMPLATE_CONTRACT_CHANGED'});
   const fresh=await ports.readContext(order);
   decision=evaluateReminder(fresh,{now:now(),lookbackHours:config.lookbackHours});
   if(decision.state!=='ELIGIBLE'||decision.initialTemplateSentAt!==receipt.initial_template_sent_at||reminderHash(decision.initialMessageId)!==receipt.initial_message_hash){
    await ports.delivery.finish(key,claimId,'PRE_SEND_BLOCKED',{...receipt,send_status:'PRE_SEND_BLOCKED',block_reason:decision.reason});return decision;
   }
   if(!await ports.verifyFreshOrder(fresh.order))throw Object.assign(Error(),{code:'REMINDER_ORDER_CHANGED_BEFORE_SEND'});
   if(!Number.isFinite(Date.parse(fresh.checkedAt))||now()-Date.parse(fresh.checkedAt)>10000||Date.parse(fresh.checkedAt)>now())throw Object.assign(Error(),{code:'REMINDER_FRESH_READ_EXPIRED'});
   const params=reminderParameters(fresh.order);
   Object.assign(receipt,{eligibility_checked_at:fresh.checkedAt,recipient_hash:reminderHash(exactPhone(fresh.order.customerPhone)),conversation_hash:reminderHash(String(fresh.subscriber.user_ns)),parameter_hash:reminderHash(params),rendered_body_hash:reminderHash(renderedReminder(finalTemplate,params))});
   receipt.send_started_at=new Date(now()).toISOString();receipt.send_status='SENDING';
   if(!await ports.delivery.finish(key,claimId,'SENDING',receipt))throw Object.assign(Error(),{code:'REMINDER_SEND_RESERVATION_UNVERIFIED'});
   // Exactly one provider POST. The shared Chatby transport owns its queue and
   // never retries this call. Persisted SENDING also survives a lost receipt.
   try{
    const sent=await ports.send({template:finalTemplate,params,subscriber:fresh.subscriber,orderId:String(order.orderId),canonicalOrderId:order.canonicalOrderId,claimId,checkedAt:receipt.eligibility_checked_at,expectedRecipient:fresh.order.customerPhone});
    const mid=sent?.data?.mid||sent?.mid||null;
    if(typeof mid==='string'&&mid.startsWith('wamid.'))receipt.provider_message_id=mid;
   }catch(error){
    if(error.notSent===true){receipt.send_started_at=null;receipt.send_status='PRE_SEND_BLOCKED';receipt.block_reason=safeCode(error);await ports.delivery.finish(key,claimId,'PRE_SEND_BLOCKED',receipt);return {state:'PRE_SEND_BLOCKED',reason:receipt.block_reason};}
    receipt.send_status='SEND_UNKNOWN';receipt.block_reason=safeCode(error);
    await ports.delivery.finish(key,claimId,'SEND_UNKNOWN',receipt);
   }
   const post=await ports.readContext(order),seen=verifyReminderReadback(post,receipt);
   if(!seen){receipt.send_status='SEND_UNKNOWN';receipt.block_reason='REMINDER_PROVIDER_READBACK_UNVERIFIED';await ports.delivery.finish(key,claimId,'SEND_UNKNOWN',receipt);return {state:'SEND_UNKNOWN',reason:receipt.block_reason};}
   receipt.send_status='VERIFIED';receipt.verified_at=new Date(now()).toISOString();receipt.provider_message_id=seen.mid;receipt.block_reason=null;
   if(!await ports.delivery.finish(key,claimId,'VERIFIED',receipt))return {state:'SEND_UNKNOWN',reason:'REMINDER_LEDGER_VERIFICATION_UNCERTAIN'};
   return {state:'VERIFIED',reason:'EXACT_PROVIDER_READBACK_VERIFIED',providerMessageId:seen.mid};
  }catch(error){
   const started=Boolean(receipt.send_started_at),state=started?'SEND_UNKNOWN':'PRE_SEND_BLOCKED';
   try{await ports.delivery.finish(key,claimId,state,{...receipt,send_status:state,block_reason:safeCode(error)});}catch{}
   return {state,reason:safeCode(error)};
  }
 }
 async function scan({replay=false,natural=false}={}){
  if(!config.enabled)return {mode:'DISABLED',externalWrites:0,results:[]};
  if(running)return {mode:mode(),state:'BUSY',externalWrites:0,results:[]};
  running=true;
  try{
   const start=now(),source=await ports.candidates({now:start,lookbackHours:config.lookbackHours,replay});
   if(!source.complete)throw Object.assign(Error(),{code:'REMINDER_CANDIDATES_INCOMPLETE'});
   const previous=(await ports.status.get())||{},canaryProof=previous.canary;
   const liveReady=canaryProof?.state==='VERIFIED'&&canaryProof.componentHash===REMINDER_COMPONENT_HASH&&canaryProof.ownerReference===config.ownerReference;
   const results=[];
   const ordered=source.orders.toSorted((a,b)=>a.canonicalOrderId.localeCompare(b.canonicalOrderId));
   const offset=ordered.length?(Number(previous.cursor||0)%ordered.length):0;
   let candidates=replay?ordered:[...ordered.slice(offset),...ordered.slice(0,offset)].slice(0,config.batchSize||2);
   if(!replay&&config.canaryEnabled){const selected=ordered.find(x=>String(x.orderId)===config.canaryOrderId);if(selected)candidates=[selected,...candidates.filter(x=>x.orderId!==selected.orderId)].slice(0,config.batchSize||2);}
   for(const order of candidates){
    const canary=config.canaryEnabled&&String(order.orderId)===config.canaryOrderId;
    const allowSend=senderReady()&&((config.realSends&&liveReady)||(!config.realSends&&canary));
    let decision;
    try{decision=await process(order,{replay,allowSend});}catch(error){decision={state:'CHATBY_NOT_VERIFIABLE',reason:safeCode(error)};}
    results.push({canonicalOrderId:order.canonicalOrderId,orderId:String(order.orderId),...decision});
    if(canary&&(decision.state==='VERIFIED'||(decision.reconciled&&decision.reason==='VERIFIED'))&&!replay)previous.canary={state:'VERIFIED',orderId:String(order.orderId),componentHash:REMINDER_COMPONENT_HASH,ownerReference:config.ownerReference,verifiedAt:new Date(now()).toISOString(),providerMessageHash:reminderHash(decision.providerMessageId)};
   }
   const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
   const daily=previous.daily?.date===date?previous.daily:{date,states:{},verifiedIds:[]};
   for(const row of results){daily.states[row.canonicalOrderId]={state:row.state,reason:row.reason};if((row.state==='VERIFIED'||row.reconciled)&&!daily.verifiedIds.includes(row.canonicalOrderId))daily.verifiedIds.push(row.canonicalOrderId);}
   const counts={...countResults(Object.values(daily.states)),reminder_sent:daily.verifiedIds.length,reminder_verified:daily.verifiedIds.length};
   const report={version:'order-confirmation-reminder-v1',at:new Date(now()).toISOString(),mode:config.realSends&&!liveReady?'SHADOW':mode(),requestedLive:config.realSends,liveBlockedReason:config.realSends&&!liveReady?'REMINDER_CANARY_NOT_VERIFIED':null,singleSenderVerified:senderReady(),canary:previous.canary||null,complete:true,coverage:{queried:ordered.length,evaluated:candidates.length,allEvaluated:ordered.length===candidates.length},cursor:ordered.length?(offset+candidates.length)%ordered.length:0,counts:replay?countResults(results):counts,daily,results,externalWrites:results.some(x=>x.state==='SEND_UNKNOWN')?null:results.filter(x=>x.state==='VERIFIED').length};
   report.replayCounts={wouldReceive:results.filter(x=>x.state==='ELIGIBLE').length,confirmedBeforeTwoHours:results.filter(x=>x.confirmedBeforeTwoHours).length,responded:results.filter(x=>x.customerActivityObserved===true).length,silentVerified:results.filter(x=>x.customerActivityObserved===false).length,initialVerified:results.filter(x=>x.initialVerified).length};
   report.naturalCycles=natural?[...(previous.naturalCycles||[]).slice(-8),{at:report.at,mode:report.mode,coverage:report.coverage,counts:countResults(results),externalWrites:report.externalWrites}]:(previous.naturalCycles||[]);
   if(!replay)await ports.status.save(report);
   return report;
  }finally{running=false;}
 }
 return {scan,process,status:()=>ports.status.get()};
}
export function countResults(rows){
 const count=state=>rows.filter(x=>x.state===state).length;
 return {reminder_candidates:rows.length,reminder_not_due:count('NOT_DUE'),reminder_customer_responded:count('CUSTOMER_RESPONDED'),reminder_already_confirmed:count('ALREADY_CONFIRMED'),reminder_initial_missing:count('INITIAL_TEMPLATE_NOT_VERIFIED'),reminder_blocked_incident:count('INCIDENT_ACTIVE'),reminder_sent:count('VERIFIED'),reminder_verified:count('VERIFIED'),reminder_send_unknown:count('SEND_UNKNOWN'),reminder_duplicate_prevented:count('REMINDER_ALREADY_SENT'),eligible:count('ELIGIBLE')};
}
