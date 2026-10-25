import {EVENT,normalizeId,digest} from './policy.mjs';

// Consume the existing PRIVATE persisted recovery audit, not Shopify orders.
// `blocked/ADDRESS_INCOMPLETE` before a POST is explicitly NOT an import failure.
// An attempted operation must correlate to a definitive rejection, same order/key.
export function persistedLegacyFailures(actions,rejections,{shop,storeId}) {
  if(!shop||!storeId)throw Error('RECOVERY_SOURCE_SCOPE_REQUIRED');
  const attempts=new Map(),generations=new Map(),events=[];
  for(const a of actions){
    if(a.result==='attempted'&&a.idempotencyKey&&a.orderId&&a.reference)attempts.set(String(a.orderId),a);
    if(a.result!=='provider_rejected'||a.status!=='provider_rejected')continue;
    const attempt=attempts.get(String(a.orderId));
    if(!attempt||attempt.reference!==a.reference||Date.parse(a.at)<Date.parse(attempt.at))continue;
    const matches=rejections.filter(r=>r.idempotencyKey===attempt.idempotencyKey&&r.http===400&&r.failure?.type==='ValidationFailure'&&
      (/^[A-Z0-9_]{1,120}$/.test(r.failure.code||'')?r.failure.code:'PROVIDER_VALIDATION_REJECTED')===a.reason&&
      Date.parse(r.at)>=Date.parse(attempt.at)&&Date.parse(r.at)<=Date.parse(a.at));
    if(matches.length!==1)continue;
    const r=matches[0],evidenceId=digest([attempt.idempotencyKey,r.at,a.at,a.orderId,a.reason]);
    const fingerprint=digest([attempt.digest||attempt.idempotencyKey,r.failure.code]);
    const previous=generations.get(String(a.orderId));
    const generation=previous?.fingerprint===fingerprint?previous:{fingerprint,id:evidenceId};
    generations.set(String(a.orderId),generation);
    events.push({type:EVENT,persisted:true,definitive:true,evidenceId,failureGeneration:generation.id,at:a.at,
      shopifyOrderId:normalizeId(a.orderId),externalReference:a.reference,shop,storeId,
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
