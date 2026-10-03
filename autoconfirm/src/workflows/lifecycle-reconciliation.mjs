import {extractWamid,isCustomerInteraction,messageTimestamp} from './incident-discount-policy.mjs';
const slug=v=>String(v||'').toLowerCase().replace(/^es_es[ _-]+/,'').replace(/[^a-z0-9]+/g,'_');
export function reconcileLifecycleObservation({order,templateName,messages=[],ledger=null,historyComplete=false,exactConversation=false,now=Date.now()}){
  const review={classification:'NEEDS_REVIEW',verified:false,send_allowed:false};
  const id=String(order?.orderId||''),created=Date.parse(order?.raw?.created_at||order?.createdAt||order?.createdAtSource);
  if(!id||!templateName||!Number.isFinite(created))return review;
  if(['DELIVERED','RETURNED','CANCELLED'].includes(order.status))return {...review,classification:'ALREADY_SUPERSEDED'};
  const target=slug(templateName);
  const proof=messages.filter(m=>{
    const raw=m.raw||m,at=messageTimestamp(m),name=raw.payload?.name||raw.content?.name||raw.template_name||raw.templateName;
    if(slug(name)!==target||isCustomerInteraction(m)||!extractWamid(m)||at<created||at>now||!Number.isFinite(at))return false;
    const body=JSON.stringify(raw.payload||raw.content||raw);
    // Exact order reference in the outgoing template, not only same telephone.
    const explicit=body.replace(/\D/g,' ').split(/\s+/).includes(id);
    const references=[...body.matchAll(/\b(?:ES|pedido[ #:]*)\s*(\d{5,})\b/gi)].map(m=>m[1]);
    if(references.some(ref=>ref!==id))return false;
    return explicit||exactConversation;
  }).sort((a,b)=>messageTimestamp(a)-messageTimestamp(b)).at(-1);
  if(proof)return {classification:'PROVIDER_SENT_MONITOR_MISSED',verified:true,send_allowed:false,sent_at:new Date(messageTimestamp(proof)).toISOString(),provider_message_id:extractWamid(proof)};
  if(String(ledger?.order_id)===id&&slug(ledger?.template_name)===target&&['sent','already_seen'].includes(ledger.status)&&extractWamid(ledger.raw)&&Date.parse(ledger.sent_at)>=created&&Date.parse(ledger.sent_at)<=now)
    return {classification:'STALE_MONITOR',verified:true,send_allowed:false,sent_at:ledger.sent_at,provider_message_id:extractWamid(ledger.raw)};
  if(historyComplete&&exactConversation)return {...review,classification:'TRUE_MISSING_SEND'};
  return review;
}
