import {EVENT,normalizeId,digest} from './policy.mjs';

// Consume the existing PRIVATE persisted recovery audit, not Shopify orders.
// `blocked/ADDRESS_INCOMPLETE` before a POST is explicitly NOT an import failure.
// An attempted operation must correlate to a definitive rejection, same order/key.
export function persistedLegacyFailures(actions,rejections,{shop,storeId}) {
  if(!shop||!storeId)throw Error('RECOVERY_SOURCE_SCOPE_REQUIRED');
  const attempts=new Map(),generations=new Map(),events=[];
  for(const a of actions){
    if(a.result==='attempted'&&a.idempotencyKey&&a.orderId&&a.reference)attempts.set(a.idempotencyKey,[...(attempts.get(a.idempotencyKey)||[]),a]);
  }
  for(const r of rejections){
    if(r.http!==400||r.failure?.type!=='ValidationFailure'||!Number.isFinite(Date.parse(r.at)))continue;
    const matches=(attempts.get(r.idempotencyKey)||[]).filter(a=>Date.parse(a.at)<=Date.parse(r.at));
    if(matches.length!==1)continue;
    const attempt=matches[0],evidenceId=digest([attempt.idempotencyKey,r.at,attempt.orderId,r.failure.code]);
    // The rejection itself is the durable failure event. Do not wait for the
    // later ledger/result append, and never trigger on a successful report.
    const fingerprint=digest([attempt.digest||attempt.idempotencyKey,r.failure.code]);
    const previous=generations.get(String(attempt.orderId));
    const generation=previous?.fingerprint===fingerprint?previous:{fingerprint,id:evidenceId};
    generations.set(String(attempt.orderId),generation);
    events.push({type:EVENT,persisted:true,definitive:true,evidenceId,failureGeneration:generation.id,at:r.at,
      shopifyOrderId:normalizeId(attempt.orderId),externalReference:attempt.reference,shop,storeId,
      source:'dropea-public-v2',failureType:'ValidationFailure',code:r.failure.code,httpStatus:r.http,
      originalError:r.failure});
  }
  return events;
}

// Future optional fallback must be server-filtered; never accept a whole-store
// list as failure evidence. A tag alone is insufficient to classify an error.
export function markedFailureEligible(order,{hasActiveCase=false}={}){
  const tags=Array.isArray(order.tags)?order.tags:String(order.tags||'').split(',').map(t=>t.trim());
  const attrs=Object.fromEntries((order.note_attributes||[]).map(a=>[a.name,a.value]));
  const marked=['error_dropea','dropea_error'].some(k=>tags.includes(k)||attrs[k]==='true');
  return marked && !order.dropea_id && !attrs.dropea_id && !order.import_recovery_resolved && !hasActiveCase;
}
export const FALLBACK_SEARCH='(tag:error_dropea OR tag:dropea_error)';
