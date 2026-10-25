import {createHash} from 'node:crypto';

export const EVENT = 'SHOPIFY_TO_DROPEA_IMPORT_FAILED';
export const TEMPLATE = 'dropea_incidencia_direccion_v1';
export const POLICY = 'address-post-failure-v1';
export const ADDRESS_CODES = Object.freeze([
  'POSTAL_CODE_INVALID', 'POSTAL_PROVINCE_MISMATCH', 'POSTAL_CITY_MISMATCH',
  'ADDRESS_INVALID', 'ADDRESS_INCOMPLETE', 'CITY_INVALID', 'PROVINCE_INVALID', 'NO_CARRIER_FOR_ADDRESS'
]);
const excluded = new Set(['AUTH_ERROR','HTTP_5XX','RATE_LIMIT','TIMEOUT','DROPEA_UNAVAILABLE',
  'PRODUCT_NOT_FOUND','PRICE_ERROR','STOCK_ERROR','INTEGRATION_ERROR','UNKNOWN_ERROR','DUPLICATE_ORDER','PAYMENT_ERROR']);

// Explicit, versioned code mapping. Never infer the class from message substrings.
// Observed Dropea ValidationFailure: this means NO service, not an invalid postcode.
const mappings = Object.freeze({
  'dropea-public-v2:ValidationFailure:POSTAL_CODE_NOT_COVERED': 'NO_CARRIER_FOR_ADDRESS',
  'dropea-public-v2:ValidationFailure:shipping_address address lines together must not exceed 100 characters': 'ADDRESS_INVALID'
});
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const claimKey = id => `SHOPIFY_DROPEA_RECOVERY:${id}`;
export const safeCode = value => /^[A-Z0-9_]{1,120}$/.test(value || '') ? value : 'RECOVERY_DEPENDENCY_UNAVAILABLE';
export const normalizeId = id => {
  const value=String(id || '').replace(/^gid:\/\/shopify\/Order\//,'');
  if(!/^[1-9]\d{0,19}$/.test(value)) throw Error('SHOPIFY_ORDER_ID_INVALID');
  return value;
};
export function flags(env = process.env) {
  const names=['ADDRESS_IMPORT_RECOVERY_ENABLED','ADDRESS_RECOVERY_SHOPIFY_WRITE','ADDRESS_RECOVERY_CHATBY_SEND','ADDRESS_RECOVERY_DROPEA_IMPORT'];
  for(const name of names) if(env[name]!==undefined && !['true','false'].includes(env[name])) throw Error('ADDRESS_RECOVERY_FLAG_INVALID');
  const [enabled,shopifyWrite,chatbySend,dropeaImport]=names.map(name=>env[name]==='true');
  if(!enabled && (shopifyWrite||chatbySend||dropeaImport)) throw Error('ADDRESS_RECOVERY_DISABLED_WITH_WRITES');
  if((chatbySend||dropeaImport)&&!shopifyWrite || dropeaImport&&!chatbySend) throw Error('ADDRESS_RECOVERY_ROLLOUT_ORDER_INVALID');
  return Object.freeze({enabled,shopifyWrite,chatbySend,dropeaImport,shadow:!shopifyWrite&&!chatbySend&&!dropeaImport});
}
export function classify(event) {
  if(event?.type!==EVENT || event.persisted!==true || !event.evidenceId || !event.failureGeneration ||
     !event.at || !Number.isFinite(Date.parse(event.at)) || !event.shop || !event.storeId || !event.externalReference) return null;
  normalizeId(event.shopifyOrderId);
  if(event.definitive!==true || excluded.has(event.code) || event.httpStatus===429 || event.httpStatus>=500 || [401,403].includes(event.httpStatus))
    return {failureClass:'NON_ADDRESS',category:null};
  const mapped=mappings[`${event.source}:${event.failureType}:${event.code}`];
  const canonical=event.source==='governed-import-event-v1' && event.mappingVersion===POLICY && ADDRESS_CODES.includes(event.code) ? event.code : null;
  return {failureClass: mapped||canonical ? 'ADDRESS':'NON_ADDRESS', category:mapped||canonical||null,
    governedCode:event.code==='shipping_address address lines together must not exceed 100 characters'?'ADDRESS_LINES_TOO_LONG':safeCode(event.code)};
}
export const clean = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
export function addressOf(order) {
  const a=order.shipping_address || {};
  return {street:a.address1 || '',line2:a.address2 || '',houseNumber:a.house_number || String(a.address1 || '').match(/(?:^|\s)(\d+[a-z]?)(?:\s|,|$)/i)?.[1] || '',
    postalCode:a.zip || '',city:a.city || '',province:a.province || '',country:a.country_code || ''};
}
export function candidateConfidence(result, source, {customer=false}={}) {
  const candidates=result?.candidates;
  const score=Number(result?.confidence);
  if(!Array.isArray(candidates) || candidates.length!==1 || !Number.isFinite(score) || score<0 || score>1) return {level:'LOW',score:0,candidate:null};
  const c=candidates[0],complete=['street','houseNumber','postalCode','city','province','country'].every(k=>typeof c[k]==='string'&&c[k].trim());
  const query=result.query;
  // The provider must attest to a full-address query, not a province-only guess.
  const scoped=query && ['street','houseNumber','city','province','country'].every(k=>source[k] && clean(query[k])===clean(source[k]));
  const compatible=complete && ['street','houseNumber','city','province','country'].every(k=>clean(c[k])===clean(source[k]));
  const trusted=result.verified===true && typeof result.evidenceId==='string' && result.evidenceId.length>0 && scoped && compatible;
  const level=score>=.95&&trusted?'HIGH':score>=.70?'MEDIUM':'LOW';
  return {level,score,candidate:complete?{...c,line2:source.line2||''}:null,customer};
}
export function sourceInvariant(order) {
  // Guard every source field (including contacts/tags/payment/lines), excluding only
  // timestamps that Shopify advances on a shipping-address update.
  const copy=structuredClone(order);delete copy.updated_at;delete copy.shipping_address;
  return digest(copy);
}
export function verifySource(order, recovery) {
  return normalizeId(order?.id)===recovery.shopifyOrderId && order.name===recovery.private.externalReference &&
    !order.cancelled_at && !order.closed_at && !order.fulfillment_status && !(order.refunds||[]).length &&
    order.currency==='EUR' && (!recovery.private.invariant || sourceInvariant(order)===recovery.private.invariant);
}
export function addressEquals(a,b) { return ['street','line2','postalCode','city','province','country'].every(k=>clean(a[k])===clean(b[k])); }
export function verifyImport(actual, expected) {
  if(!actual?.id || actual.externalReference!==expected.externalReference || String(actual.storeId)!==String(expected.storeId) ||
     actual.currency!==expected.currency || actual.totalCents!==expected.totalCents || !addressEquals(actual.address || {}, expected.address || {})) return false;
  const units=lines=>{
    const m=new Map();
    for(const l of lines||[]){if(!l.variantId||!Number.isInteger(l.quantity)||l.quantity<1)return null;m.set(String(l.variantId),(m.get(String(l.variantId))||0)+l.quantity);}
    return m.size?[...m].sort(([a],[b])=>a.localeCompare(b)):null;
  };
  const a=units(actual.units),e=units(expected.units);
  return !!a&&!!e&&JSON.stringify(a)===JSON.stringify(e);
}
