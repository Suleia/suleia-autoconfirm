import {businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';

// Authentication is injected by the API boundary. Do not import operational
// integrations into the Meta module graph. Every order request remains GET.
// Do not fetch customer, billing or shipping contact fields for Ads diagnosis.
export function createAlgorithmOrdersReader({env=process.env,fetchImpl=fetch,authenticatedRead=null}={}){
 const config={shopifyDomain:env.SHOPIFY_DOMAIN||env.SHOPIFY_SHOP,shopifyApiVersion:env.SHOPIFY_API_VERSION||'2026-04',shopifyAdminAccessToken:env.SHOPIFY_ADMIN_ACCESS_TOKEN||env.SHOPIFY_ACCESS_TOKEN};
 if(!env.SHOPIFY_DOMAIN&&!env.SHOPIFY_SHOP)return null;
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(config.shopifyDomain||''))throw Error('SHOPIFY_DOMAIN_INVALID');
 if(!authenticatedRead&&!config.shopifyAdminAccessToken)return null;
 const read=authenticatedRead||((url,opts)=>fetchImpl(url,{...opts,headers:{'X-Shopify-Access-Token':config.shopifyAdminAccessToken}})),root=`https://${config.shopifyDomain}/admin/api/${config.shopifyApiVersion}/`;
 return async range=>{
  const start=businessDayBounds({businessDate:range.since}).utc_start,end=businessDayBounds({businessDate:range.until}).utc_end_exclusive;
  const fields='id,name,created_at,processed_at,updated_at,financial_status,fulfillment_status,total_price,currency,total_discounts,line_items,source_name,note_attributes,cancelled_at,test';
  let url=root+'orders.json?'+new URLSearchParams({status:'any',limit:'250',created_at_min:start,created_at_max:end,fields}),rows=[],seen=new Set();
  for(let page=0;url&&page<100;page++){
   if(!url.startsWith(root)||seen.has(url))throw Error('SHOPIFY_PAGINATION_INVALID');seen.add(url);
   const r=await read(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('SHOPIFY_AUDIT_UNAVAILABLE');
   const j=await r.json();if(!Array.isArray(j.orders))throw Error('SHOPIFY_PAYLOAD_INVALID');
   rows.push(...j.orders.filter(o=>Date.parse(o.created_at)<Date.parse(end)).map(o=>({id:String(o.id),reference:o.name,createdAt:o.created_at,processedAt:o.processed_at,updatedAt:o.updated_at,financialStatus:o.financial_status,fulfillmentStatus:o.fulfillment_status,amount:Number(o.total_price),currency:o.currency,discounts:Number(o.total_discounts),products:(o.line_items||[]).map(l=>({productId:String(l.product_id),variantId:String(l.variant_id),quantity:l.quantity})),source:o.source_name,attributes:o.note_attributes,cancelledAt:o.cancelled_at,test:o.test})));
   url=r.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1]||null;
  }
  if(url)throw Error('SHOPIFY_PAGINATION_INCOMPLETE');return rows;
 };
}
