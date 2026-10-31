import {carePolicyFor} from '../customer-care/runtime.mjs';
import {hash} from '../customer-care/context.mjs';
import {verifiedProductKnowledge} from './product-knowledge.mjs';
const cents=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?Math.round(v*100):null;
const fresh=(at,now)=>Number.isFinite(Date.parse(at))&&now-Date.parse(at)>=0&&now-Date.parse(at)<=60000;
export function currentProviderState(order){
 const raw=order?.raw||{},status=raw.status||order?.status,sub=raw.sub_status;
 if(status==='FINISH'&&['DELIVERED','RETURNED','CANCELLED'].includes(sub))return sub;
 if(status==='SHIPPING')return sub==='OUT_FOR_DELIVERY'?'OUT_FOR_DELIVERY':'IN_TRANSIT';
 if(status==='PROCESSING')return ['PREPARED','READY_TO_SHIP'].includes(sub)?'PREPARED':'PREPARING';
 return ['ERROR','INCIDENCE'].includes(status)?'INCIDENCE':status;
}
// Only the existing worker supplies freshProof after its actual GETs. Nothing
// from a customer message, cached price, model output or support email is proof.
export function liveCarePolicy(input,{now=Date.now(),supportReceipt=null,paymentMethods=[],authorizationRef=null}={}){
 const p=carePolicyFor(input),{order,incident,issue}=input,raw=order?.raw||{},i=issue?.raw||issue||{},proof=input.freshProof||{};
 const verified=proof.exactConversationVerified===true&&fresh(proof.orderReadAt,now)&&fresh(proof.conversationReadAt,now)&&String(i.id)===String(incident?.incidenceId)&&String(i.order_id)===String(order?.orderId);
 const current=cents(raw.total_amount),amount=cents(order?.orderAmount);
 const moneyVerified=verified&&raw.currency==='EUR'&&current!==null&&current===amount&&raw.payment_method==='COD';
 const r=supportReceipt?.raw||{},plan=r.supportPlan||{};
 const exactDiscountReceipt=supportReceipt?.status==='verified'&&String(r.orderId||plan.orderId)===String(order.orderId)&&plan.conversationId===incident.chatbyUserNs&&Number.isSafeInteger(r.originalCents)&&Number.isSafeInteger(r.finalCents)&&r.originalCents-r.finalCents===500;
 const applied=moneyVerified&&exactDiscountReceipt&&current===r.finalCents;
 const amountConflict=moneyVerified&&exactDiscountReceipt&&current!==r.finalCents;
 return {...p,liveVerifiedContext:verified,liveReplyOwnerBusy:['claimed','sending','applied_unverified','delivery_unverified','reconciliation_claimed','manual_reconciliation_required'].includes(input.sharedIssueReceipt?.status),providerReadVerified:verified,providerReadAt:verified?proof.orderReadAt:null,
  verifiedOrderState:verified?currentProviderState(order):null,
  paymentVerified:moneyVerified&&!amountConflict&&!!authorizationRef&&paymentMethods.length>0,paymentMethod:moneyVerified?'COD':null,
  amountDue:moneyVerified&&!amountConflict?current/100:null,amountReadAt:moneyVerified&&!amountConflict?proof.orderReadAt:null,
  allowedPaymentMethods:moneyVerified&&!amountConflict&&authorizationRef?paymentMethods.filter(m=>['CASH','CARD'].includes(m)):[],
  discountAmountConflict:amountConflict,
  paymentContractSource:authorizationRef||null,discountAppliedVerified:applied,
  verifiedProductKnowledge:verified?verifiedProductKnowledge(order,{now}):null,
  amountProofHash:moneyVerified?hash([order.orderId,current,raw.currency,raw.payment_method,applied]):null};
}
export function stableCarePolicy(policy){
 const {providerReadAt,amountReadAt,trackingReadAt,liveReplyOwnerBusy,...stable}=policy||{};return stable;
}
