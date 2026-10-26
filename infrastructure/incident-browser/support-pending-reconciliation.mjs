import {moneyCents,SUPPORT_WORKFLOW,SUPPORT_TO} from '../../autoconfirm/src/workflows/accepted-discount-support.mjs';
const id=x=>/^[1-9]\d*$/.test(String(x||''));
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);

// Reconcile the original request. There is deliberately no send or resolve
// adapter: a failed carrier action must never trigger another POST or email.
export async function reconcilePendingSupport(incident,receipt,deps){
 const out={orderId:String(incident.orderId),currentIssueId:String(incident.incidenceId),checkedAt:new Date().toISOString(),
  status:'RECONCILIATION_REQUIRED',reason:'SUPPORT_CLAIM_UNCERTAIN',needsHumanReview:true,emailVerified:false,
  providerSolutionVerified:false,discountApplied:false,carrierCodApplied:null};
 const r=receipt?.raw;
 if(!id(incident.orderId)||!id(incident.incidenceId)||receipt?.template_name!==SUPPORT_WORKFLOW
   ||receipt.provider!=='gmail_then_dropea'||receipt.store_id!=='suleia'||String(receipt.order_id)!==out.orderId
   ||receipt.chatby_user_ns!==incident.chatbyUserNs||r?.workflow!==SUPPORT_WORKFLOW
   ||String(r.orderId)!==out.orderId||String(r.issueId)!==out.currentIssueId||r.phase!=='SOLUTION_REQUESTED'
   ||!r.mailId||!digest(r.snapshot)||!date(r.acceptedAt)||!date(r.requestedAt))return out;
 try{
  const {candidate,plan}=await deps.readPlan(incident,receipt);
  if(!plan?.eligible||plan.snapshot!==r.snapshot||!digest(plan.key)||plan.email?.to!==SUPPORT_TO
    ||plan.orderId!==out.orderId||plan.issueId!==out.currentIssueId||candidate.exactOrder!==true||candidate.readVerified!==true
    ||String(candidate.orderId)!==plan.orderId||String(candidate.issueId)!==plan.issueId||String(candidate.ownerId)!==plan.ownerId
    ||candidate.conversationId!==plan.conversationId||candidate.phone!==plan.phone||candidate.conversationPhone!==plan.phone
    ||String(candidate.acceptanceMessageId)!==plan.acceptanceMessageId||candidate.acceptedAt!==plan.acceptedAt
    ||String(r.acceptanceMessageId)!==plan.acceptanceMessageId||r.acceptedAt!==plan.acceptedAt
    ||String(candidate.offerMessageId)!==plan.offerMessageId||candidate.offerAt!==plan.offerAt
    ||candidate.intent!=='ACCEPTS_DISCOUNT'||candidate.offerVerified!==true
    ||moneyCents(candidate.originalAmount)!==plan.originalCents||moneyCents(candidate.offeredAmount)!==plan.finalCents
    ||plan.originalCents-plan.finalCents!==500||r.originalCents!==plan.originalCents||r.finalCents!==plan.finalCents)
   return {...out,reason:'SUPPORT_CURRENT_EVIDENCE_CHANGED'};
  out.expectedAmountCents=plan.finalCents;
  if(!await deps.verifyMail(r.mailId,plan,r.attachmentHashes))return {...out,reason:'SUPPORT_SENT_MAIL_NOT_VERIFIED'};
  out.emailVerified=true;
  const operation=await deps.readOperation(plan);
  if(operation?.status==='failed'&&typeof operation.errorCode==='string'&&/^[A-Z0-9_]{1,100}$/.test(operation.errorCode)){
   return {...out,status:'SUPPORT_SENT_PROVIDER_REJECTED',reason:operation.errorCode,providerErrorCode:operation.errorCode};
  }
  if(operation?.status!=='completed')return {...out,reason:'SUPPORT_OPERATION_NOT_VERIFIED'};
  if(!await deps.verifySolution(plan))return {...out,reason:'SUPPORT_CURRENT_SOLUTION_NOT_VERIFIED'};
  await deps.finishVerified(plan,receipt);
  return {...out,status:'SUPPORT_SENT_SOLUTION_VERIFIED',reason:'CARRIER_COD_NOT_VERIFIED',needsHumanReview:false,providerSolutionVerified:true};
 }catch{return {...out,reason:'SUPPORT_RECONCILIATION_READ_FAILED'};}
}
