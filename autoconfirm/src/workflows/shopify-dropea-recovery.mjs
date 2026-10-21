import {createHash} from 'node:crypto';

export const RECOVERY_TEMPLATE = 'shopify_dropea_import_v1';
const cents = value => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw Error('INVALID_MONEY');
  return Math.round(Number(value) * 100);
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = reason => ({eligible:false,reason});
const qtyMap = lines => {
  const map = new Map();
  for (const line of lines || []) map.set(Number(line.variant_id),(map.get(Number(line.variant_id))||0)+Number(line.quantity));
  return [...map].sort((a,b)=>a[0]-b[0]);
};

// No address correction, stock substitution, price invention or confirmation.
export function planShopifyDropeaRecovery(order, products, carriers, {
  storeId, now=Date.now(), minimumAgeMs=30*60_000, maximumAgeMs=7*86400_000, blocked=false
}={}) {
  if (!/^\d+$/.test(String(order?.id)) || !/^#?\d+$/.test(order?.name||'')) return fail('SOURCE_ID_INVALID');
  if (blocked) return fail('BLOCKED_CUSTOMER');
  if (order.cancelled_at || order.closed_at || order.fulfillment_status || (order.refunds||[]).length) return fail('SOURCE_NOT_OPEN_UNFULFILLED');
  const age=now-Date.parse(order.created_at);
  if (!Number.isFinite(age)||age<minimumAgeMs) return fail('WAIT_NATIVE_IMPORT');
  if (age>maximumAgeMs) return fail('STALE_ORDER_REQUIRES_REVIEW');
  if (order.currency!=='EUR') return fail('CURRENCY_UNSUPPORTED');
  const gateways=order.payment_gateway_names||[];
  const cod=gateways.some(g=>/^(Cash on Delivery(?: \(COD\))?|Contra ?reembolso|COD)$/i.test(g));
  if (!(cod&&['pending','paid'].includes(order.financial_status)) && order.financial_status!=='paid') return fail('PAYMENT_NOT_ELIGIBLE');
  if (!cod) return fail('NON_COD_REQUIRES_REVIEW');
  const address=order.shipping_address||{};
  if (address.country_code!=='ES'||!/^\d{5}$/.test(address.zip||'')) return fail('ADDRESS_MARKET_UNSUPPORTED');
  if (!address.first_name||!address.address1||!address.city||!address.province) return fail('ADDRESS_INCOMPLETE');
  const phone=address.phone||order.phone||'';
  if (!/^(?:34)?[6789]\d{8}$/.test(phone.replace(/\D/g,''))) return fail('PHONE_INVALID');
  // Match Dropea's native COD import convention, verified against existing
  // source/provider pairs with no source email. This is a provider routing
  // identifier, never a customer-supplied email or a Shopify customer edit.
  const sourceEmail=order.email||order.contact_email||'';
  const digits=phone.replace(/\D/g,'');
  const email=sourceEmail||`${digits.length===9?'34'+digits:digits}@dropea.io`;
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail('EMAIL_INVALID');
  // This is the store's existing standard service, verified against the live catalog.
  // Island/overseas destinations need their actual service; never force a mainland one.
  if (/^(07|35|38|51|52)/.test(address.zip)) return fail('NON_MAINLAND_SERVICE_REQUIRES_REVIEW');
  if (!carriers.some(c=>c.code==='GLS'&&c.services?.some(s=>s.code==='96|18'&&s.is_active))) return fail('STANDARD_CARRIER_UNAVAILABLE');
  const lines=[], suppliers=new Set();
  try {
    for (const line of order.line_items||[]) {
      const q=line.current_quantity??line.quantity;
      if (!Number.isInteger(q)||q<1||q!==line.quantity||line.requires_shipping===false) return fail('LINE_REQUIRES_REVIEW');
      const matches=products.flatMap(p=>(p.variants||[]).filter(v=>line.sku&&v.sku===line.sku).map(v=>({p,v})));
      if (matches.length!==1) return fail('SKU_MAPPING_NOT_UNIQUE');
      const {p,v}=matches[0];
      if (!Number.isInteger(v.variant_id)||!p.owner_id) return fail('CATALOG_INCOMPLETE');
      suppliers.add(p.owner_id);
      if (!Number.isFinite(v.stock)||v.stock<q) return fail('INSUFFICIENT_STOCK');
      const discount=(line.discount_allocations||[]).reduce((n,d)=>n+cents(d.amount),0);
      const net=cents(line.price)*q-discount;
      if (net<0) return fail('INVALID_DISCOUNT');
      // Allocate any remaining cent to one unit, preserving exact total and units.
      const base=Math.floor(net/q), remainder=net%q;
      if (q>remainder) lines.push({variant_id:v.variant_id,quantity:q-remainder,unit_price:base/100});
      if (remainder) lines.push({variant_id:v.variant_id,quantity:remainder,unit_price:(base+1)/100});
    }
    if (!lines.length||suppliers.size!==1) return fail('SUPPLIER_OR_LINES_REQUIRE_REVIEW');
    const expectedCents=cents(order.total_price);
    if (expectedCents<=0||lines.reduce((n,l)=>n+Math.round(l.unit_price*100)*l.quantity,0)!==expectedCents) return fail('TOTAL_NOT_REPRESENTABLE');
    const payload={store_id:Number(storeId),external_order_id:order.name,line_items:lines,payment_method:'COD',carrier:'GLS',service_type:'96|18',customer_details:{
      name:address.name||[address.first_name,address.last_name].filter(Boolean).join(' '),email,phone,
      shipping_address:{first_name:address.first_name,last_name:address.last_name||'',address_line_1:address.address1,address_line_2:address.address2||'',city:address.city,state:address.province,postal_code:address.zip,country:address.country_code}
    }};
    if (!Number.isInteger(payload.store_id)||payload.store_id<1) return fail('STORE_INVALID');
    const digest=hash(payload);
    return {eligible:true,payload,expectedCents,digest,technicalContact:!sourceEmail,sourceId:String(order.id),reference:order.name,idempotencyKey:`suleia-shopify-import-${storeId}-${order.id}-${digest.slice(0,12)}`};
  } catch { return fail('SOURCE_MONEY_INVALID'); }
}

export function verifyRecoveredOrder(actual,plan) {
  if (!actual?.id||actual.store_id!==plan.payload.store_id||actual.external_order_id!==plan.reference) return false;
  if (!['PENDING','CONFIRMED','PROCESSING','SHIPPING','FINISH','DELIVERED'].includes(actual.status)) return false;
  if (actual.currency!=='EUR'||Math.round(Number(actual.total_amount)*100)!==plan.expectedCents||actual.payment_method!=='COD') return false;
  if (JSON.stringify(qtyMap(actual.line_items))!==JSON.stringify(qtyMap(plan.payload.line_items))) return false;
  const a=actual.shipping_address||{},e=plan.payload.customer_details.shipping_address;
  const phoneKey=value=>String(value||'').replace(/\D/g,'').replace(/^34(?=\d{9}$)/,'');
  return ['address_line_1','address_line_2','city','state','postal_code','country'].every(k=>String(a[k]||'')===String(e[k]||''))
    &&phoneKey(a.phone_number)===phoneKey(plan.payload.customer_details.phone)
    &&String(a.email||'').toLowerCase()===plan.payload.customer_details.email.toLowerCase();
}

export async function recoverShopifyOrder(order,{products,carriers,storeId,now,blocked,live=false,
  findExisting,readSource,readCreated,createOrder,claim,finish,audit
}) {
  const identity={orderId:String(order.id),reference:order.name};
  // Always check Dropea even for older orders, before flagging a missing order.
  const existing=await findExisting(order.name);
  if (existing.length) return {...identity,status:existing.length===1?'already_present':'duplicate_reference',dropeaOrderIds:existing.map(x=>x.id)};
  const plan=planShopifyDropeaRecovery(order,products,carriers,{storeId,now,blocked});
  if (!plan.eligible) return {...identity,status:'blocked',reason:plan.reason};
  if (!live) return {...identity,status:'ready',totalCents:plan.expectedCents,digest:plan.digest};
  const reservation=await claim(identity.orderId,{digest:plan.digest,idempotencyKey:plan.idempotencyKey});
  if (!reservation.acquired||!reservation.persistent) return {...identity,status:'blocked',reason:reservation.reason||'PERSISTENT_CLAIM_REQUIRED'};
  const attemptedAt=new Date().toISOString();
  const fresh=await readSource(identity.orderId);
  const freshPlan=planShopifyDropeaRecovery(fresh,products,carriers,{storeId,now:now??Date.now(),blocked});
  if (!freshPlan.eligible||freshPlan.digest!==plan.digest) {
    await finish(identity.orderId,{status:'source_changed',attemptedAt,lastError:'SOURCE_CHANGED'});
    return {...identity,status:'blocked',reason:'SOURCE_CHANGED'};
  }
  const raced=await findExisting(order.name);
  if (raced.length) {
    await finish(identity.orderId,{status:'reconciled_existing',attemptedAt,raw:{dropeaOrderIds:raced.map(x=>x.id)}});
    return {...identity,status:raced.length===1?'already_present':'duplicate_reference',dropeaOrderIds:raced.map(x=>x.id)};
  }
  await audit({...identity,at:attemptedAt,reason:'missing_shopify_import',result:'attempted',idempotencyKey:plan.idempotencyKey,digest:plan.digest});
  try {
    // Exactly one POST. An uncertain result must be reconciled, never blindly replayed.
    const created=await createOrder(plan.payload,plan.idempotencyKey);
    const actual=await readCreated(created.id);
    const matches=await findExisting(plan.reference);
    const verified=verifyRecoveredOrder(actual,plan)&&matches.length===1&&matches[0].id===actual.id;
    const result={...identity,status:verified?'verified':'applied_unverified',dropeaOrderId:actual?.id||created.id,at:new Date().toISOString(),totalCents:Math.round(Number(actual?.total_amount)*100)};
    await finish(identity.orderId,{status:result.status,attemptedAt,sentAt:verified?result.at:null,raw:{...result,digest:plan.digest,idempotencyKey:plan.idempotencyKey}});
    await audit({...result,reason:'missing_shopify_import',result:result.status});
    return result;
  } catch(error) {
    const reason=/^[A-Z0-9_]{1,120}$/.test(error?.code||'')?error.code:'CREATE_RESULT_UNCERTAIN';
    const status=error.definitive===true?'provider_rejected':'applied_unverified';
    const result={...identity,status,reason,at:new Date().toISOString()};
    await finish(identity.orderId,{status,attemptedAt,lastError:reason,raw:{digest:plan.digest,idempotencyKey:plan.idempotencyKey,definitive:error.definitive===true}});
    await audit({...result,reason,result:status});
    return result;
  }
}
