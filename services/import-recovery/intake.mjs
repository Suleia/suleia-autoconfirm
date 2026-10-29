import {EVENT,POLICY,normalizeId,digest} from './policy.mjs';

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

// Native Dropea app notes, observed in Shopify. A tag, a planning block or a
// loose text match never establishes a failure. Require the native note event
// AND an exact, current-address-bound note signature. Preserve it encrypted.
export function persistedNativeFailure(order,events,{shop,storeId,observedAt}){
  if(!markedFailureEligible(order)||!Array.isArray(events))return null;
  const a=order.shipping_address||{},note=String(order.note||'');
  if(a.country_code!=='ES')return null;
  let code=null;
  const postal=note.match(/^dropea_error: Postal code ([^\r\n]{1,160}) has an invalid format for country ES$/);
  const coverage=note.match(/^dropea_error: No carrier ships to postal code ([^\r\n]{1,160}) in ES$/);
  if(postal&&postal[1]===a.zip&&!/^\d{5}$/.test(a.zip||''))code='POSTAL_CODE_INVALID';
  if(coverage&&coverage[1]===a.zip)code='NO_CARRIER_FOR_ADDRESS';
  if(note==='dropea_error: La ciudad de la direccion de envio es demasiado corta. Corrigela en el pedido de Shopify y vuelve a enviarlo a Dropea.'&&String(a.city||'').trim().length<2)code='CITY_INVALID';
  if(!code)return null;
  const notes=events.filter(e=>e.author==='dropea'&&e.verb==='note_created'&&e.id&&
    Number.isFinite(Date.parse(e.created_at))&&Date.parse(e.created_at)>=Date.parse(order.created_at)&&
    Date.parse(e.created_at)<=Date.parse(observedAt));
  if(!notes.length)return null;
  const last=notes.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  const evidenceId=digest([shop,String(order.id),last.id,note]);
  return {type:EVENT,persisted:true,definitive:true,evidenceId,failureGeneration:evidenceId,
    at:last.created_at,shopifyOrderId:normalizeId(order.id),externalReference:order.name,shop,storeId,
    source:'governed-import-event-v1',mappingVersion:POLICY,code,httpStatus:400,
    originalError:{source:'shopify-native-dropea-note-v1',note,eventId:last.id,observedAt}};
}
