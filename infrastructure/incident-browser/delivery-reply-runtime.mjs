import fs from 'node:fs/promises';
import {deliveryReplyPlan} from './delivery-reply-policy.mjs';
import {executeDeliveryReply,verifiedDeliverySolution,verifiedDeliverySolutionState,solutionNoteHash} from './delivery-reply-executor.mjs';
import {loadProviderEnv} from './worker.mjs';
import {readEvidenceDetail} from './dropea-ui.mjs';
import {recoverPreSaveClaim} from './pre-save-claim-recovery.mjs';

const stateFile='/state/delivery-reply-inflight.json';
const issueKey=p=>({storeId:'suleia',orderId:p.orderId,templateName:`incident_resolution_v1:${p.issueId}`,provider:'dropea'});
export async function readPersistedDetailProof(context,plan,{read=readEvidenceDetail,write=fs.writeFile}={}){
 let view;try{view=await read(context,plan);}catch{throw Error('PERSISTED_DETAIL_READ_FAILED');}
 const {page,dialog}=view;
 // The dialog becomes visible before its asynchronous detail payload arrives.
 // Wait for the expected persisted text, then read the live locator, not the
 // earlier snapshot returned while the modal was loading.
 const named=page.getByRole('dialog',{name:'Detalle de Incidencia',exact:true});
 try{await named.waitFor({state:'visible',timeout:15000});}catch{throw Error('PERSISTED_DETAIL_DIALOG_NOT_OBSERVED');}
 try{await dialog.getByText(plan.note,{exact:false}).waitFor({state:'visible',timeout:15000});}catch{throw Error('PERSISTED_NOTE_NOT_OBSERVED');}
 const text=await dialog.innerText(),normalized=s=>String(s||'').replace(/\s+/g,' ').trim();
 if(await named.count()!==1||!text.includes('ES'+plan.orderId)||!normalized(text).includes(normalized(plan.note)))return null;
 const proof={provider:'DROPEA_PERSISTED_DETAIL',verified:true,orderId:plan.orderId,issueId:plan.issueId,
  noteHash:solutionNoteHash(plan.note),observedAt:new Date().toISOString()};
 await page.screenshot({path:`/evidence/verified-solution-${plan.orderId}-${plan.issueId}.png`,timeout:15000});
 await write(`/evidence/verified-solution-${plan.orderId}-${plan.issueId}.json`,JSON.stringify(proof),{mode:0o600});
 await dialog.getByText('Cerrar',{exact:true}).click();
 return proof;
}
export async function reconcileDeliveryReply(pending,{read,verify,finish,clear}){
 try{
  const current=await read(pending.plan);
  if(!await verify(pending.plan,pending.attemptedAt,current))return {verified:false,reason:'PERSISTED_SOLUTION_NOT_VERIFIED'};
  await finish('verified',pending.plan,pending.attemptedAt);await clear();
  return {verified:true};
 }catch(e){
  const allowed=new Set(['PERSISTED_DETAIL_READ_FAILED','PERSISTED_DETAIL_DIALOG_NOT_OBSERVED','PERSISTED_NOTE_NOT_OBSERVED']);
  return {verified:false,reason:allowed.has(e.message)?e.message:'SOLUTION_RECONCILIATION_READ_FAILED'};
 }
}
async function updateControl(patch){
 const old=JSON.parse(await fs.readFile('/state/retry-control.json','utf8'));
 await fs.writeFile('/state/delivery-control.tmp',JSON.stringify({...old,...patch}),{mode:0o600});
 await fs.rename('/state/delivery-control.tmp','/state/retry-control.json');
}

// Remains in the existing 30-minute worker, shares the existing issue/message
// ledgers and never owns address, discount, return or confirmation workflows.
export async function runDeliveryReplyCycle(context,{deadlineAt=Date.now()+15*60000}={}){
 await loadProviderEnv();
 const {selectRows,upsertRows,updateRows}=await import('../../autoconfirm/src/clients/supabase.mjs');
 const {getIncidentChatMessages,loadSubscriberIndex,findSubscriberInIndexForExactOrder,sendTextMessage}=await import('../../autoconfirm/src/clients/chatby.mjs');
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 const {executeDropeaV2Resolution}=await import('../../autoconfirm/src/clients/dropea-v2-issue-actions.mjs');
 const {getTemplateDelivery,claimTemplateDelivery,finishTemplateDelivery}=await import('../../autoconfirm/src/db/supabase-store.mjs');
 const {inspectPriorOrderReturn}=await import('../../autoconfirm/src/workflows/incident-order-return-guard.mjs');
 const {extractWamid,messageTimestamp}=await import('../../autoconfirm/src/workflows/incident-discount-policy.mjs');
 const started=Date.now(),report={at:new Date().toISOString(),mode:'OBSERVE_ONLY',solutions:0,messages:0,cases:[]};
 const preparationRecoveries=new Map();
 const control=JSON.parse(await fs.readFile('/state/retry-control.json','utf8'));
 const canWrite=['AUTO','AUTO_CANARY'].includes(control.mode)&&['AUTO','AUTO_CANARY'].includes(control.deliveryReplyMode);
 report.mode=canWrite?control.deliveryReplyMode:'OBSERVE_ONLY';
 async function verifyPersisted(plan,attemptedAt,current=null){
  const after=current||await readDropeaV2ReturnIssueState({orderId:plan.orderId,incidenceId:plan.issueId},{includeOrder:true});
  const raw=after.issue?.raw||after.issue;
  if(!verifiedDeliverySolutionState(raw,plan,attemptedAt))return false;
  if(verifiedDeliverySolution(raw,plan,attemptedAt))return true;
  // Public Issue DTO omits resolution_note. Read the persisted DETAIL view,
  // never the draft form and never press Save again to obtain this evidence.
  if(!context)return false;
  const proof=await readPersistedDetailProof(context,plan);
  return verifiedDeliverySolution(raw,plan,attemptedAt,proof);
 }
 const finish=async(status,p,attemptedAt=new Date().toISOString())=>{
  const r=await finishTemplateDelivery({...issueKey(p),status,attemptedAt,sentAt:status==='verified'?new Date().toISOString():null,
   raw:{owner:'vps_delivery_reply',reason:p.reason,orderId:p.orderId,issueId:p.issueId,contextHash:p.hash,
    messageId:p.messageId,note:p.note,date:p.date,time_window:p.time_window,status,customerIntent:p.customer_intent||null,waitingForOrder:p.waiting_for_order===true,deliveryAttemptDeniedByCustomer:p.delivery_attempt_denied_by_customer===true,logisticsStatus:status==='verified'?'AWAITING_NEW_DELIVERY':null,commerciallyClosed:false,
    ...(preparationRecoveries.has(p.issueId)?{preSaveRecovery:preparationRecoveries.get(p.issueId)}:{})}});
  if(r?.skipped)throw Error('DELIVERY_REPLY_DURABLE_JOURNAL_REQUIRED');
 };
 // Reconcile an interrupted POST using reads only, before admitting any other
 // new solution. Preserve the shared claim on every uncertain outcome.
 let pending=null;try{pending=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(pending){
  const reconciliation=await reconcileDeliveryReply(pending,{
   read:p=>readDropeaV2ReturnIssueState({orderId:p.orderId,incidenceId:p.issueId},{includeOrder:true}),
   verify:verifyPersisted,finish,clear:()=>fs.unlink(stateFile)
  });
  if(reconciliation.verified){
   if(canWrite&&control.deliveryReplyMode==='AUTO_CANARY'){
    await updateControl({deliveryReplyMode:'AUTO',deliveryReplyCanary:{verified:true,orderId:pending.plan.orderId,at:new Date().toISOString()}});
    control.deliveryReplyMode='AUTO';report.mode='AUTO';
   }
   report.reconciled=1;
  }else{
   report.status='RECONCILIATION_REQUIRED';report.completedAt=new Date().toISOString();
   report.cases.push({orderId:pending.plan.orderId,issueId:pending.plan.issueId,status:'RECONCILE',reason:reconciliation.reason,solutionAttempted:false});
   await fs.writeFile('/state/delivery-reply-report.tmp',JSON.stringify(report),{mode:0o600});await fs.rename('/state/delivery-reply-report.tmp','/state/delivery-reply-report.json');
   await upsertRows('app_state',{key:'vps_incident_delivery_replies_v1',value:report,updated_at:report.completedAt},{onConflict:'key',timeoutMs:10000});
   return {mode:report.mode,status:report.status,reason:reconciliation.reason,observed:1,solutions:0,messages:0,review:1};
  }
 }
 const cached=(await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value,updated_at'},limit:1}))[0];
 if(!Array.isArray(cached?.value?.incidents)||!Number.isFinite(Date.parse(cached.updated_at))||Date.now()-Date.parse(cached.updated_at)>3600000)throw Error('CURRENT_INCIDENT_CACHE_REQUIRED');
 let index=null,admitted=0;
 for(const incident of cached.value.incidents.filter(i=>['absent','rejected_goods'].includes(i.incidentType))){
  if(Date.now()-started>15*60000||Date.now()+120000>deadlineAt)break;
  const item={orderId:String(incident.orderId),issueId:String(incident.incidenceId)};
  try{
   const current=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});
   const raw=current.issue?.raw||current.issue;
   if(raw.status!=='PENDING'||!raw.is_active||raw.resolution_status)continue;
   if(!incident.chatbyUserNs)continue;
   const messages=await getIncidentChatMessages(incident.chatbyUserNs);
   // A cached label is not identity evidence. Re-prove the exact subscriber or
   // the exact-order sent-template ledger + same WAMID in the live transcript.
   async function association(order,transcript,force=false){
    if(!index||force)index=await loadSubscriberIndex({maxPages:30,force:true});
    const s=findSubscriberInIndexForExactOrder(index,{phone:order.customerPhone,orderId:incident.orderId});
    if(s?.user_ns===incident.chatbyUserNs)return true;
    if(incident.chatbyOrderAssociation!=='EXACT_ORDER_MERCHANDISE_LEDGER')return false;
    const row=await getTemplateDelivery({storeId:'suleia',orderId:incident.orderId,templateName:'es_ES dropea_incidencia_mercancia_v1'});
    if(!row||String(row.order_id)!==String(incident.orderId)||row.chatby_user_ns!==incident.chatbyUserNs||!['sent','already_seen'].includes(row.status))return false;
    const at=Date.parse(row.sent_at),mid=extractWamid(row.raw);
    return Number.isFinite(at)&&at>=Date.parse(order.createdAt)&&at>=Date.parse(incident.incidenceDate)&&!!mid&&
     transcript.some(m=>String(m.user_ns)===incident.chatbyUserNs&&extractWamid(m)===mid&&Math.abs(messageTimestamp(m)-at)<120000);
   }
   // Preliminary pure classification avoids full subscriber scans for silence.
   const scoped={...incident,chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'};
   let plan=deliveryReplyPlan({incident:scoped,...current,messages});
   if(!plan.eligible){report.cases.push({...item,status:'BLOCKED',reason:plan.reason,...(plan.context?{context:plan.context}:{})});continue;}
   if(!await association(current.order,messages)){report.cases.push({...item,status:'BLOCKED',reason:'FRESH_EXACT_ORDER_ASSOCIATION_REQUIRED'});continue;}
   const prior=await inspectPriorOrderReturn(incident);
   if(prior.verified||prior.blocked){report.cases.push({...item,status:'BLOCKED',reason:'PRIOR_RETURN_GUARD'});continue;}
   const observed={...item,status:'PREPARED',kind:plan.kind,reason:plan.reason,date:plan.date,time_window:plan.time_window,proposedSolution:plan.note||null,providerRawType:raw.type,customerIntent:plan.customer_intent||null,waitingForOrder:plan.waiting_for_order===true,deliveryAttemptDeniedByCustomer:plan.delivery_attempt_denied_by_customer===true,nextBestAction:plan.next_best_action||null,...(plan.context?{context:plan.context}:{})};
   if(!canWrite||(control.deliveryReplyMode==='AUTO_CANARY'&&(admitted||control.deliveryReplyCanaryOrderId&&String(control.deliveryReplyCanaryOrderId)!==plan.orderId))){report.cases.push(observed);continue;}
   let attemptedAt=null;
   const revalidate=async()=>{
    const fresh=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});
    const replies=await getIncidentChatMessages(incident.chatbyUserNs);
    if(!await association(fresh.order,replies,true))return {eligible:false,reason:'FRESH_ASSOCIATION_REQUIRED'};
    const guard=await inspectPriorOrderReturn(incident);if(guard.verified||guard.blocked)return {eligible:false,reason:'PRIOR_RETURN_GUARD'};
    return deliveryReplyPlan({incident:scoped,...fresh,messages:replies});
   };
   const result=await executeDeliveryReply(plan,{
    revalidate,readMessages:getIncidentChatMessages,claimMessage:claimTemplateDelivery,finishMessage:finishTemplateDelivery,send:sendTextMessage,
    waitForReadback:()=>new Promise(resolve=>setTimeout(resolve,1500)),
    claimSolution:async p=>{
     const claim=await claimTemplateDelivery(issueKey(p));if(claim.acquired||!claim.persistent)return claim;
     const recovered=await recoverPreSaveClaim(p,claim.existing,{
      readEvidence:async()=>{
       const audit=await fs.readFile('/state/retry-audit.jsonl','utf8');if(audit.length>1024*1024)throw Error('AUDIT_LIMIT');
       const cycles=JSON.parse(await fs.readFile('/state/cycle-history.json','utf8'));if(!Array.isArray(cycles)||cycles.length>200)throw Error('CYCLE_LIMIT');
       let journalPresent=false;for(const name of ['retry-inflight.json','retry-reconcile.json','delivery-reply-inflight.json'])try{await fs.access('/state/'+name);journalPresent=true;}catch(e){if(e.code!=='ENOENT')throw e;}
       return {events:audit.trim().split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)),cycles,journalPresent};
      },
      compareAndSet:(values,query)=>updateRows('template_delivery_ledger',values,{query,returning:'representation'})
     });
     if(recovered.acquired)preparationRecoveries.set(p.issueId,recovered.proof);
     return recovered;
    },finishSolution:(s,p,a)=>finish(s,p,a||attemptedAt||new Date().toISOString()),
    journal:async(p,at)=>{attemptedAt=at;await fs.writeFile('/state/delivery-reply-inflight.tmp',JSON.stringify({plan:p,attemptedAt:at}),{mode:0o600});await fs.rename('/state/delivery-reply-inflight.tmp',stateFile);},
    clearJournal:()=>fs.unlink(stateFile),
    writeSolution:p=>executeDropeaV2Resolution(p.issueId,'PROVIDE_SOLUTION',{note:p.note},{idempotencyNonce:p.hash}),
    verifySolution:verifyPersisted
   });
   admitted++;report.cases.push({...observed,...result,reason:result.reason||plan.reason});
   if(result.status==='VERIFIED'){
    if(plan.kind==='SOLUTION')report.solutions++;
    else if(!result.alreadySent&&!result.reconciled)report.messages++;
    if(control.deliveryReplyMode==='AUTO_CANARY'&&plan.kind==='SOLUTION'){
     await updateControl({deliveryReplyMode:'AUTO',deliveryReplyCanary:{verified:true,orderId:plan.orderId,at:new Date().toISOString()}});
     control.deliveryReplyMode='AUTO';report.mode='AUTO';
    }
   }
   await fs.appendFile('/state/delivery-reply-audit.jsonl',JSON.stringify({at:new Date().toISOString(),...item,...result,reason:result.reason||plan.reason})+'\n',{mode:0o600});
   if(result.solutionAttempted&&result.status!=='VERIFIED')break;
  }catch(e){report.cases.push({...item,status:'REVIEW_REQUIRED',reason:typeof e.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:'DELIVERY_REPLY_READ_OR_EXECUTION_FAILED'});
   try{await fs.access(stateFile);break;}catch{}
  }
 }
 report.completedAt=new Date().toISOString();
 await fs.writeFile('/state/delivery-reply-report.tmp',JSON.stringify(report),{mode:0o600});await fs.rename('/state/delivery-reply-report.tmp','/state/delivery-reply-report.json');
 await upsertRows('app_state',{key:'vps_incident_delivery_replies_v1',value:report,updated_at:report.completedAt},{onConflict:'key',timeoutMs:10000});
 return {mode:report.mode,observed:report.cases.length,solutions:report.solutions,messages:report.messages,
  review:report.cases.filter(c=>['RECONCILE','REVIEW_REQUIRED'].includes(c.status)).length};
}
