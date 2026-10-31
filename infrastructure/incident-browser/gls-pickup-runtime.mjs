import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGlsDirectory,readGlsTracking,collectGlsPickupIncidents} from './gls-pickup-source.mjs';
import {canonicalPickup,pickupPlan,matchingPickupMessage} from './gls-pickup-policy.mjs';
import {PICKUP_TEMPLATE,PICKUP_OWNER,pickupTemplateStatus} from '../../autoconfirm/src/workflows/gls-pickup-template.mjs';
import {compileCustomerCase} from '../../autoconfirm/src/customer-context/case-compiler.mjs';
import {extractWamid,isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
const metricNames=['pickup_incidents_detected','pickup_ready_verified','gls_lookup_success','gls_lookup_failed','agency_conflicts','missing_agency_data','cod_reconciliation_blocked','pickup_notice_1_eligible','pickup_notice_1_sent','pickup_notice_1_verified','pickup_notice_1_unknown','pickup_notice_1_already_sent','pickup_notice_1_duplicate_prevented','pickup_notice_1_customer_replied','pickup_notice_1_manual_review'];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const save=async(file,value)=>{await fs.writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await fs.rename(file+'.tmp',file);};
export async function executePickupNotice(plan,deps){
 const prior=await deps.get(plan);if(prior)return deps.reconcile(prior);
 const claim=await deps.claim(plan);if(!claim?.acquired||!claim.persistent)return {state:'MANUAL_REVIEW',reason:'PERSISTENT_CLAIM_NOT_ACQUIRED',duplicate_prevented:true};
 const attemptedAt=new Date().toISOString();
 // Journal the exact payload before entering the one existing sender queue.
 // A crash from here on is read-only reconciliation, even without a receipt.
 await deps.finish(plan,'claimed',{plan,attemptedAt,owner:PICKUP_OWNER,post_attempts_max:1});
 let receipt;
 try{
  receipt=await deps.send(plan.payload,{beforeDispatch:async readers=>{
   const fresh=await deps.revalidate(readers);
   if(!fresh.eligible||fresh.fingerprint!==plan.fingerprint)throw Error('PICKUP_DISPATCH_CONTEXT_CHANGED');
   if(await deps.alreadySeen(readers,plan))throw Error('PICKUP_MESSAGE_ALREADY_SEEN');
   return {expiresAt:Math.min(Date.now()+20000,fresh.fresh_expires_at??Infinity)};
  }});
 }catch(e){const state=e.notSent?'MANUAL_REVIEW':'SEND_UNKNOWN';await deps.finish(plan,e.notSent?'not_sent':'send_unknown',{plan,attemptedAt,owner:PICKUP_OWNER,post_attempts_max:1,proven_no_post:e.notSent===true});return {state,reason:e.notSent?'DISPATCH_BLOCKED_ZERO_POST':'PROVIDER_OUTCOME_UNKNOWN'};}
 const wamid=extractWamid(receipt);
 await deps.finish(plan,wamid?'provider_accepted':'send_unknown',{plan,attemptedAt,owner:PICKUP_OWNER,wamid,post_attempts_max:1});
 let proof=null;try{proof=await deps.readback(plan,{attemptedAt,wamid});}catch{}
 if(!extractWamid(proof))return {state:wamid?'SENT_PROVIDER_ACCEPTED':'SEND_UNKNOWN',reason:'HISTORY_READBACK_PENDING',provider_accepted:!!wamid};
 await deps.finish(plan,'verified',{plan,attemptedAt,owner:PICKUP_OWNER,wamid:extractWamid(proof),readback_verified:true,post_attempts_max:1});
 return {state:'MESSAGE_VERIFIED',reason:'EXACT_TEMPLATE_MESSAGE_VERIFIED',provider_accepted:true,verified:true,wamid:extractWamid(proof)};
}
export async function runGlsPickupCycle(context,{deadlineAt=Date.now()+240000}={}){
 await(await import('./worker.mjs')).loadProviderEnv();
 const {selectRows,upsertRows}=await import('../../autoconfirm/src/clients/supabase.mjs');
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 const {getIncidentChatMessages,getIncidentSubscriberInfo,findSubscriberInIndexForExactOrder,listExactWhatsappTemplates,sendWhatsappTemplate}=await import('../../autoconfirm/src/clients/chatby.mjs');
 const {getTemplateDelivery,claimTemplateDelivery,finishTemplateDelivery}=await import('../../autoconfirm/src/db/supabase-store.mjs');
 const control=JSON.parse(await fs.readFile('/state/retry-control.json','utf8'));
 const flags=control.glsPickupNotice||{};
 const report={at:new Date().toISOString(),owner:PICKUP_OWNER,desired_mode:flags.mode||'OFF',mode:'OFF',template:null,cases:[],metrics:Object.fromEntries(metricNames.map(k=>[k,0])),logistics_writes:0,notice_sequence:[1],customer_care_owner:'SULEIA_CUSTOMER_CARE_AGENT'};
 if(flags.enabled!==true||!['SHADOW','CANARY','LIVE'].includes(flags.mode)||flags.authorizationRef!=='OWNER-2026-10-31-GLS-PICKUP-1')return report;
 const args=p=>({storeId:'suleia',orderId:p.order_id,templateName:p.key,provider:'chatby',chatbyUserNs:p.conversation_id});
 const finish=async(p,status,raw)=>{const r=await finishTemplateDelivery({...args(p),status,attemptedAt:raw.attemptedAt,sentAt:status==='verified'?new Date().toISOString():null,raw});if(r?.skipped)throw Error('PICKUP_DURABLE_JOURNAL_REQUIRED');};
 async function reconcile(row){
  const p=row.raw?.plan;if(!p)return {state:'MANUAL_REVIEW',reason:'CLAIM_WITHOUT_EXACT_PAYLOAD',duplicate_prevented:true};
  if(row.status==='verified'){
   let customer_replied=false;try{customer_replied=(await getIncidentChatMessages(p.conversation_id)).some(m=>String(m.user_ns)===p.conversation_id&&isCustomerInteraction(m)&&messageTimestamp(m)>Date.parse(row.raw.attemptedAt));}catch{}
   return {state:customer_replied?'MESSAGE_VERIFIED':'WAITING_CUSTOMER',reason:customer_replied?'EXISTING_CUSTOMER_CARE_OWNS_REPLY':'ALREADY_VERIFIED',verified:true,already_sent:true,customer_replied,wamid:row.raw.wamid};
  }
  if(row.status==='not_sent')return {state:'MANUAL_REVIEW',reason:'PROVEN_ZERO_POST_CLAIM_RETAINED',duplicate_prevented:true};
  let proof;try{proof=matchingPickupMessage(await getIncidentChatMessages(p.conversation_id),p,{attemptedAt:row.raw.attemptedAt,wamid:row.raw.wamid});}catch{}
  if(proof){await finish(p,'verified',{...row.raw,readback_verified:true,wamid:extractWamid(proof),reconciled_at:new Date().toISOString()});return {state:'MESSAGE_VERIFIED',verified:true,already_sent:true,wamid:extractWamid(proof)};}
  return {state:row.status==='provider_accepted'?'SENT_PROVIDER_ACCEPTED':'SEND_UNKNOWN',reason:'READ_ONLY_RECONCILIATION_REQUIRED',duplicate_prevented:true};
 }
 let cache={};try{cache=JSON.parse(await fs.readFile('/state/gls-agency-cache.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const directory=createGlsDirectory({cache,ttlMs:flags.agencyCacheTtlMs});
 const trackingOptions={retryUntil:Number(cache.__tracking_retry_until||0),onRateLimit:async until=>{cache.__tracking_retry_until=until;trackingOptions.retryUntil=until;await save('/state/gls-agency-cache.json',cache);}};
 const releaseArgs={storeId:'suleia',orderId:'__gls_pickup_notice_release__',templateName:'GLS_PICKUP_NOTICE_1_CANARY',provider:'chatby'};
 let release=await getTemplateDelivery(releaseArgs);
 let template;
 try{template=pickupTemplateStatus(await listExactWhatsappTemplates(PICKUP_TEMPLATE));}catch{template={approved:false,status:'CATALOG_UNAVAILABLE'};}
 report.template=template;report.mode=flags.mode==='SHADOW'?'SHADOW':release?.status==='verified'?'LIVE':'CANARY';
 const native=await collectGlsPickupIncidents({deadlineAt:Math.min(deadlineAt,Date.now()+60000)});
 let candidates=native.filter(canonicalPickup).sort((a,b)=>Number(a.order.orderId)-Number(b.order.orderId));report.metrics.pickup_incidents_detected=candidates.length;
 let cursor={};try{cursor=JSON.parse(await fs.readFile('/state/gls-pickup-cursor.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const offset=candidates.findIndex(r=>r.order.orderId===cursor.last_order_id)+1;
 candidates=[...candidates.slice(offset),...candidates.slice(0,offset)];
 const cached=(await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value,updated_at'},limit:1}))[0];
 const known=cached?.value?.incidents||[];
 const receipts=await selectRows('template_delivery_ledger',{query:{template_name:'like.GLS_PICKUP_NOTICE_1:*',select:'*'},limit:1000});
 // Reconcile even after an issue was closed/replaced. Never replay a send.
 for(const r of receipts.filter(r=>!['verified','not_sent'].includes(r.status)).slice(0,5)){
  if(Date.now()+20000>deadlineAt)break;const result=await reconcile(r);report.cases.push({order_id:r.order_id,issue_id:r.raw?.plan?.issue_id,...result,observed_at:new Date().toISOString()});
 }
 // An uncertain first canary is never replaced by a different customer.
 if(release&&release.status!=='verified'){
  const pin=receipts.find(r=>r.template_name===release.raw?.key);
  if(pin?.status==='verified'&&pin.raw?.readback_verified){await finishTemplateDelivery({...releaseArgs,status:'verified',raw:{...release.raw,verified:true,wamid:pin.raw.wamid}});release={status:'verified'};report.mode='LIVE';}
 }
 for(const base of candidates){
  const item={order_id:base.order.orderId,issue_id:String(base.issue.id),state:'PICKUP_DETECTED',observed_at:new Date().toISOString()};
  if(Date.now()+35000>deadlineAt){report.cases.push({...item,reason:'CYCLE_BUDGET_DEFERRED'});continue;}
  cursor.last_order_id=base.order.orderId;
  try{
   const incident={...(known.find(i=>String(i.incidenceId)===String(base.issue.id)&&String(i.orderId)===base.order.orderId)||{}),orderId:base.order.orderId,incidenceId:String(base.issue.id)};
   const fresh=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});
   if(!canonicalPickup(fresh)){report.cases.push({...item,state:'CLOSED',reason:'PICKUP_INCIDENT_NOT_ACTIVE'});continue;}
   const o=fresh.order.raw,postal=String(o.shipping_address?.postal_code||'');
   const tracking=await readGlsTracking(context,{url:o.tracking_url,tracking:String(o.tracking_number),postal},{...trackingOptions,saveDiagnostic:d=>save(`/evidence/gls-pickup-${base.order.orderId}-tracking-private.json`,d)});
   item.tracking={state:tracking.state,verified:tracking.verified,observed_at:tracking.observed_at};
   let agency=null;try{agency=await directory.lookup(postal,{agencyCode:tracking.agency_code});item.agency=agency;report.metrics.gls_lookup_success++;}catch(e){report.metrics.gls_lookup_failed++;item.lookup_reason=/^[A-Z_]+$/.test(e.message)?e.message:'GLS_LOOKUP_FAILED';}
   if(!agency&&flags.allowVerifiedTrackingFallback===true&&tracking.verified&&tracking.state==='READY'&&tracking.agency){agency=tracking.agency;item.agency=agency;item.agency_fallback='EXACT_CURRENT_TRACKING_FULL_AGENCY';}
   if(!tracking.verified){report.cases.push({...item,state:'MANUAL_REVIEW',reason:'OFFICIAL_TRACKING_DATA_NOT_VERIFIABLE'});continue;}
   if(tracking.state!=='READY'){report.cases.push({...item,state:['COLLECTED','RETURNED','CANCELLED'].includes(tracking.state)?'CLOSED':'WAITING_FOR_PICKUP_AVAILABILITY',reason:'PACKAGE_NOT_READY'});continue;}
   report.metrics.pickup_ready_verified++;
   const previous=receipts.find(r=>r.order_id===base.order.orderId&&r.raw?.plan?.tracking_id===tracking.tracking_id&&r.raw?.plan?.episode_id===tracking.episode_id);
   if(previous){report.cases.push({...item,...await reconcile(previous)});continue;}
   if(!incident.chatbyUserNs){report.cases.push({...item,state:'MANUAL_REVIEW',reason:'EXACT_CONVERSATION_NOT_AVAILABLE'});continue;}
   const supportReceipt=await getTemplateDelivery({storeId:'suleia',orderId:base.order.orderId,templateName:'accepted_discount_support_v1'});
   const readInput=async(current,t,sub,messages,status,receipt=supportReceipt)=>{
    const digits=s=>String(s||'').replace(/\D/g,'').slice(-9),phone=digits(current.order.customerPhone);
    const exact=!!phone&&sub.user_ns===incident.chatbyUserNs&&digits(sub.phone||sub.user_id)===phone&&findSubscriberInIndexForExactOrder({byPhone:new Map([[phone,[sub]]])},{phone:current.order.customerPhone,orderId:current.order.orderId})?.user_ns===sub.user_ns;
    const scoped={...incident,chatbyReadVerified:true,chatbyOrderAssociation:exact?'EXACT_ORDER':null};
    const care=compileCustomerCase({...current,incident:scoped,messages,binding:{verified:exact,orderId:current.order.orderId,issueId:incident.incidenceId,conversationId:sub.user_ns}});
    return {...current,otherActiveIssue:base.otherActiveIssue,tracking:t,agency:agency?.validation_status==='VERIFIED_TRACKING_ONLY'?t.agency:agency,allowTrackingFallback:flags.allowVerifiedTrackingFallback===true,template:status,subscriber:sub,care,exactSubscriber:exact,whatsappVerified:messages.some(m=>String(m.user_ns)===sub.user_ns&&!!extractWamid(m)),supportReceipt:receipt,discountAccepted:incident.incidentDiscountResponseStatus==='DISCOUNT_ACCEPTED'};
   };
   const messages=await getIncidentChatMessages(incident.chatbyUserNs),sub=await getIncidentSubscriberInfo(incident.chatbyUserNs);
   const plan=pickupPlan(await readInput(fresh,tracking,sub,messages,template));
   if(!plan.eligible){report.cases.push({...item,...plan});continue;}
   report.metrics.pickup_notice_1_eligible++;
   const old=matchingPickupMessage(messages,plan,{attemptedAt:fresh.order.createdAt});
   if(old){report.cases.push({...item,state:'MANUAL_REVIEW',reason:'PREEXISTING_MESSAGE_REQUIRES_LEDGER_RECONCILIATION'});continue;}
   if(flags.mode==='SHADOW'){report.cases.push({...item,state:'READY_TO_NOTIFY',reason:'SHADOW_NO_SEND'});continue;}
   if(report.mode==='CANARY'){
    if(!release){const claimed=await claimTemplateDelivery(releaseArgs);if(claimed.acquired&&claimed.persistent){await finishTemplateDelivery({...releaseArgs,status:'claimed',raw:{key:plan.key,order_id:plan.order_id,authorization:flags.authorizationRef}});release={status:'claimed',raw:{key:plan.key}};}}
    if(release?.raw?.key!==plan.key){report.cases.push({...item,state:'READY_TO_NOTIFY',reason:'WAITING_FIRST_CANARY_VERIFICATION'});continue;}
   }
   const baseline=digest(messages);
   const result=await executePickupNotice(plan,{
    get:p=>getTemplateDelivery(args(p)),claim:p=>claimTemplateDelivery(args(p)),finish,reconcile,send:sendWhatsappTemplate,
    revalidate:async readers=>{
     const freshReadAt=Date.now();
     const current=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});
     const subscriber=await readers.readSubscriber(incident.chatbyUserNs),history=await readers.readMessages(incident.chatbyUserNs);
     if(digest(history)!==baseline)throw Error('PICKUP_NEW_CONVERSATION_EVENT');
     const status=pickupTemplateStatus(await readers.readTemplates());
     const receipt=await getTemplateDelivery({storeId:'suleia',orderId:base.order.orderId,templateName:'accepted_discount_support_v1'});
     const latest=await readGlsTracking(context,{url:current.order.raw.tracking_url,tracking:String(current.order.raw.tracking_number),postal:String(current.order.raw.shipping_address?.postal_code||'')},trackingOptions);
     const p=pickupPlan(await readInput(current,latest,subscriber,history,status,receipt));return {...p,fresh_expires_at:freshReadAt+60000};
    },alreadySeen:async(readers,p)=>!!matchingPickupMessage(await readers.readMessages(p.conversation_id),p,{attemptedAt:fresh.order.createdAt}),
    readback:async(p,receipt)=>matchingPickupMessage(await getIncidentChatMessages(p.conversation_id),p,receipt)
   });
   report.cases.push({...item,...result,amount_cents:plan.amount_cents,tracking_url:plan.tracking.source_url,tracking_id:plan.tracking_id,episode_id:plan.episode_id,template_id:plan.template_id,meta_template_id:plan.meta_template_id});
   if(result.provider_accepted)report.metrics.pickup_notice_1_sent++;
   if(result.verified&&report.mode==='CANARY'){await finishTemplateDelivery({...releaseArgs,status:'verified',raw:{...release.raw,verified:true,wamid:result.wamid}});report.mode='LIVE';release={status:'verified'};}
  }catch(e){report.cases.push({...item,state:'MANUAL_REVIEW',reason:/^[A-Z_]+$/.test(e.code||e.message)?e.code||e.message:'PICKUP_FRESH_READ_UNAVAILABLE'});}
 }
 report.cases=[...new Map(report.cases.map(c=>[c.order_id+':'+c.issue_id,c])).values()];
 for(const c of report.cases){if(c.verified)report.metrics.pickup_notice_1_verified++;if(c.already_sent)report.metrics.pickup_notice_1_already_sent++;if(c.customer_replied)report.metrics.pickup_notice_1_customer_replied++;if(c.duplicate_prevented)report.metrics.pickup_notice_1_duplicate_prevented++;if(c.state==='SEND_UNKNOWN')report.metrics.pickup_notice_1_unknown++;if(c.state==='MANUAL_REVIEW')report.metrics.pickup_notice_1_manual_review++;if(c.state==='GLS_AGENCY_CONFLICT')report.metrics.agency_conflicts++;if(c.state==='WAITING_COD_RECONCILIATION')report.metrics.cod_reconciliation_blocked++;if(c.reason==='MISSING_VERIFIED_AGENCY_DATA')report.metrics.missing_agency_data++;}
 await save('/state/gls-pickup-cursor.json',cursor);
 report.completed_at=new Date().toISOString();await save('/state/gls-agency-cache.json',cache);await save('/state/gls-pickup-report.json',report);
 await upsertRows('app_state',{key:'gls_pickup_notice_v1',value:report,updated_at:report.completed_at},{onConflict:'key',timeoutMs:8000});
 return {mode:report.mode,template_status:template.status,...report.metrics,logistics_writes:0};
}
