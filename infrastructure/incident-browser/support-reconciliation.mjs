import {moneyCents,SUPPORT_WORKFLOW} from '../../autoconfirm/src/workflows/accepted-discount-support.mjs';
import {messageTimestamp,isCustomerInteraction} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {rejectedIntent} from '../../autoconfirm/src/workflows/recipient-rejected-policy.mjs';

export const SUPPORT_FEEDBACK_KEY='accepted_discount_support_feedback_v1';
export const supportCaseKey=i=>`${i.orderId}:${i.incidenceId||i.currentIssueId}`;
const id=value=>/^[1-9]\d*$/.test(String(value||''));
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stamp=value=>date(value)?Date.parse(value):NaN;
export function sameSpanishSupportPhone(left,right){
 const canonical=value=>{
  const digits=String(value||'').replace(/\D/g,'').replace(/^0034/,'34');
  return /^(?:34)?[6789]\d{8}$/.test(digits)?`34${digits.slice(-9)}`:null;
 };
 const first=canonical(left);return Boolean(first&&first===canonical(right));
}

export async function selectSupportCandidates(pendingCases,previousCases,readReceipt){
 if(pendingCases.length>200)throw Error('SUPPORT_CANDIDATE_LIMIT');
 const checked=new Map((Array.isArray(previousCases)?previousCases:[]).map(c=>[supportCaseKey(c),Date.parse(c.checkedAt)||0]));
 const candidates=[],knownByCase=new Map();let reconciliations=0;
 for(const incident of [...pendingCases].sort((a,b)=>(checked.get(supportCaseKey(a))||0)-(checked.get(supportCaseKey(b))||0))){
  const known=await readReceipt(incident);knownByCase.set(supportCaseKey(incident),known);
  if(known?.status==='verified'){if(reconciliations++<10)candidates.push(incident);}
  else if(known||incident.incidentDiscountResponseStatus==='DISCOUNT_ACCEPTED')candidates.push(incident);
 }
 return {candidates,knownByCase};
}

function verifiedReceipt(incident,receipt,now){
 const r=receipt?.raw;
 return receipt?.status==='verified'&&receipt.store_id==='suleia'&&receipt.provider==='gmail_then_dropea'
  &&receipt.template_name===SUPPORT_WORKFLOW&&String(receipt.order_id)===String(incident.orderId)
  &&receipt.chatby_user_ns===incident.chatbyUserNs&&r?.workflow===SUPPORT_WORKFLOW
  &&String(r.orderId)===String(incident.orderId)&&id(r.issueId)&&r.phase==='SOLUTION_VERIFIED'
  &&typeof r.mailId==='string'&&r.mailId.length>0&&digest(r.snapshot)
  &&Number.isSafeInteger(r.originalCents)&&Number.isSafeInteger(r.finalCents)&&r.finalCents>0&&r.originalCents-r.finalCents===500
  &&String(r.acceptanceMessageId||'').length>0&&String(r.acceptanceMessageId).length<=256&&date(r.acceptedAt)&&date(r.verifiedAt)
  &&stamp(r.acceptedAt)<stamp(r.verifiedAt)&&stamp(r.verifiedAt)<=now+60000
  &&Array.isArray(r.attachmentHashes)&&r.attachmentHashes.length>0&&r.attachmentHashes.length<=4
  &&r.attachmentHashes.every(a=>digest(a.sha256));
}

// This path has no send, resolve, claim or financial writer. A previous receipt
// never authorizes a new incidence, even when the order amount is now reduced.
export async function reconcileVerifiedSupport(incident,receipt,deps,{now=Date.now(),ownerId}={}){
 const out={orderId:String(incident.orderId),currentIssueId:String(incident.incidenceId),supportIssueId:id(receipt?.raw?.issueId)?String(receipt.raw.issueId):null,
  checkedAt:new Date(now).toISOString(),status:'SUPPORT_RECONCILIATION_REVIEW_REQUIRED',reason:'SUPPORT_RECEIPT_UNVERIFIED',
  supportVerified:false,needsHumanReview:true,reopened:false,orderAmountStatus:'ORDER_AMOUNT_UNVERIFIED',orderDiscountApplied:null,
  currentAmountCents:null,expectedAmountCents:null,currency:null,discountApplied:false,carrierCodApplied:null,
  customerResponseStatus:'UNVERIFIED',customerResponseAt:null,customerResponseAfterCurrentIssue:false};
 if(!id(incident.orderId)||!id(incident.incidenceId)||!incident.chatbyUserNs||!verifiedReceipt(incident,receipt,now))return out;
 out.supportVerified=true;out.expectedAmountCents=receipt.raw.finalCents;
 try{
  const current=await deps.readCurrent(incident),issue=current?.issue?.raw||current?.issue,order=current?.order;
  if(String(issue?.id)!==out.currentIssueId||String(issue?.order_id)!==out.orderId||String(order?.orderId)!==out.orderId
    ||!id(ownerId)||String(issue.owner_id)!==String(ownerId))return {...out,reason:'CURRENT_IDENTITY_UNVERIFIED'};
  const pending=issue.status==='PENDING'&&issue.is_active===true;
  out.reopened=pending&&(out.currentIssueId!==out.supportIssueId||stamp(issue.updated_at)>stamp(receipt.raw.verifiedAt));
  out.currentIssueStatus=['PENDING','RESOLVED','MANAGING_WITH_CLIENT'].includes(issue.status)?issue.status:'OTHER';
  // currencyCode has a legacy EUR default. Only explicit provider metadata may
  // establish currency; total_amount verifies the order, never parcel COD.
  const raw=order.raw||{},amount=moneyCents(raw.total_amount);
  out.currency=raw.currency==='EUR'?'EUR':null;
  if(out.currency==='EUR'&&amount!==null){
   out.currentAmountCents=amount;
   if(amount===receipt.raw.finalCents){out.orderAmountStatus='ORDER_AMOUNT_DISCOUNT_VERIFIED';out.orderDiscountApplied=true;}
   else if(amount===receipt.raw.originalCents){out.orderAmountStatus='ORDER_AMOUNT_CHANGE_PENDING';out.orderDiscountApplied=false;}
   else{out.orderAmountStatus='ORDER_AMOUNT_CHANGED';out.orderDiscountApplied=false;}
  }
  const shared=await deps.readShared(incident);
  const uncertainShared=Boolean(shared&&shared.status!=='verified');
  out.sharedActionStatus=shared?(shared.status==='verified'?'VERIFIED':'UNVERIFIED'):'NONE';
  const conversation=await deps.readConversation(incident,order);
  if(conversation?.exactOrder!==true||conversation?.sameConversation!==true||conversation?.samePhone!==true||!Array.isArray(conversation.messages))
   return {...out,reason:'FRESH_CONVERSATION_ASSOCIATION_UNVERIFIED'};
  const inbound=conversation.messages.filter(isCustomerInteraction);
  if(inbound.some(m=>!Number.isFinite(messageTimestamp(m))||messageTimestamp(m)>now+60000))return {...out,reason:'CUSTOMER_EVIDENCE_UNVERIFIED'};
  const original=inbound.find(m=>String(m.id)===String(receipt.raw.acceptanceMessageId)&&messageTimestamp(m)===stamp(receipt.raw.acceptedAt));
  if(!original)return {...out,reason:'ORIGINAL_ACCEPTANCE_NOT_OBSERVED'};
  const latest=inbound.filter(m=>messageTimestamp(m)>=stamp(receipt.raw.acceptedAt)).sort((a,b)=>messageTimestamp(a)-messageTimestamp(b)).at(-1);
  const tied=inbound.filter(m=>messageTimestamp(m)===messageTimestamp(latest));
  if(tied.some(m=>String(m.id)!==String(latest.id)))return {...out,reason:'CUSTOMER_MESSAGE_ORDER_AMBIGUOUS'};
  const originalStillLatest=String(latest.id)===String(receipt.raw.acceptanceMessageId);
  out.customerResponseAt=new Date(messageTimestamp(latest)).toISOString();
  out.customerResponseAfterCurrentIssue=Number.isFinite(stamp(issue.created_at))&&messageTimestamp(latest)>=stamp(issue.created_at);
  out.customerResponseStatus=originalStillLatest?'ORIGINAL_ACCEPTANCE':rejectedIntent(addressMessageText(latest),{offerVerified:true}).intent;
  if(uncertainShared)return {...out,reason:'SHARED_ACTION_UNCERTAIN'};
  if(!originalStillLatest&&out.customerResponseStatus!=='ACCEPTS_DISCOUNT')return {...out,reason:'CUSTOMER_RESPONSE_CHANGED'};
  if(out.orderAmountStatus!=='ORDER_AMOUNT_DISCOUNT_VERIFIED')return {...out,reason:out.orderAmountStatus};
  if(pending)return {...out,reason:out.reopened?'INCIDENT_REOPENED_REVIEW_REQUIRED':'INCIDENT_PENDING_REVIEW_REQUIRED'};
  if(!['RESOLVED','MANAGING_WITH_CLIENT'].includes(issue.status))return {...out,reason:'CURRENT_ISSUE_STATE_UNVERIFIED'};
  return {...out,status:'SUPPORT_RECONCILED',reason:'CARRIER_COD_NOT_VERIFIED',needsHumanReview:false};
 }catch{return {...out,reason:'FRESH_SUPPORT_READ_FAILED'};}
}

const fields=['orderId','currentIssueId','supportIssueId','checkedAt','status','reason','supportVerified','needsHumanReview','reopened',
 'orderAmountStatus','orderDiscountApplied','currentAmountCents','expectedAmountCents','currency','discountApplied','carrierCodApplied',
 'customerResponseStatus','customerResponseAt','customerResponseAfterCurrentIssue','currentIssueStatus','sharedActionStatus'];
export function supportFeedbackProjection(result){
 return Object.fromEntries(fields.filter(k=>result[k]!==undefined).map(k=>[k,result[k]]));
}
