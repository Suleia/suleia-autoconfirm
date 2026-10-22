// Only the existing minimal order reader is accepted. No customer/contact data
// or inferred campaign matching is exposed to the review report.
export function aggregateCommerce(orders,{range,shop,observedAt}){
 if(!Array.isArray(orders))throw Error('COMMERCE_PAYLOAD_INVALID');
 const valid=orders.filter(o=>o.test!==true&&!o.cancelledAt),ids=new Set(valid.map(o=>String(o.id)));
 if(ids.size!==valid.length||valid.some(o=>o.currency!=='EUR'||!Number.isFinite(o.amount)||o.amount<0))throw Error('COMMERCE_COVERAGE_INVALID');
 return {shop,expectedShop:shop,observedAt,range,orders:valid.length,orderTotal:valid.reduce((s,o)=>s+o.amount,0),
  products:[...new Set(valid.flatMap(o=>(o.products||[]).map(p=>String(p.productId))))].map(productId=>({productId,units:valid.flatMap(o=>o.products||[]).filter(p=>String(p.productId)===productId).reduce((s,p)=>s+p.quantity,0)})),
  cartAdditions:null,sessionsThatCompletedCheckout:null,sessionsStatus:'UNAVAILABLE',campaignOrderAttribution:'UNVERIFIED',cashSettlementVerified:false,
  note:'Order total is an order snapshot, not ShopifyQL net sales or settled revenue. Session funnel unavailable from the current production reader.'};
}
