import fs from 'node:fs/promises';
import path from 'node:path';
import {createShopifyReadAuth} from '../src/clients/shopify-read-auth.mjs';
import {isBlockedCustomerOrder} from '../src/policies/blocked-customers.mjs';
import {getAppConfig} from '../src/config.mjs';
import {claimTemplateDelivery,finishTemplateDelivery} from '../src/db/supabase-store.mjs';
import {updateRows} from '../src/clients/supabase.mjs';
import {recoverShopifyOrder,RECOVERY_TEMPLATE,recoveryCorrection} from '../src/workflows/shopify-dropea-recovery.mjs';

const config=getAppConfig();
const live=process.argv.includes('--live');
if(live&&process.env.SULEIA_SHOPIFY_DROPEA_LIVE!=='true') throw Error('RECOVERY_LIVE_NOT_ENABLED');
const target=process.argv.find(x=>x.startsWith('--order-id='))?.slice(11);
if(target&&!/^\d+$/.test(target))throw Error('SOURCE_ID_INVALID');
if(config.shopifyDomain!=='vcnby0-h1.myshopify.com')throw Error('SHOPIFY_SHOP_MISMATCH');
const storeId=16088,base='https://es.public-api.dropea.com';
const readToken=process.env.DROPEA_READ_JWT_ES,writeToken=process.env.DROPEA_RECOVERY_WRITE_JWT;
function tokenScope(token,needed){
 try{const c=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());const s=c.scope??c.scopes??c.permissions;const scopes=Array.isArray(s)?s:String(s||'').split(/[\s,]+/);if(c.exp*1000<=Date.now()||!scopes.includes(needed))throw Error();}
 catch{throw Error('RECOVERY_TOKEN_NOT_READY');}
}
tokenScope(readToken,'dp:orders:read');
if(live)tokenScope(writeToken,'dp:orders:create');
let nextRequestAt=0;
async function dropea(url,{method='GET',body,key,retry=0}={}){
 if(!url.startsWith(base+'/dropshipper/'))throw Error('DROPEA_HOST_MISMATCH');
 if(nextRequestAt>Date.now())await new Promise(resolve=>setTimeout(resolve,nextRequestAt-Date.now()));
 nextRequestAt=Date.now()+750;
 const r=await fetch(url,{method,headers:{Accept:'application/json',Authorization:'Bearer '+(method==='GET'?readToken:writeToken),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30_000),redirect:'error'});
 const j=await r.json().catch(()=>null);
 if(r.status===429&&method==='GET'&&retry<2){await new Promise(resolve=>setTimeout(resolve,Math.min(30,Math.max(5,Number(r.headers.get('retry-after'))||5))*1000));return dropea(url,{method,retry:retry+1});}
 if(!r.ok&&!(r.status===504&&j?.data?.operation_id)){
  const e=Error('DROPEA_HTTP_'+r.status);e.code='DROPEA_HTTP_'+r.status;
  if(method==='POST'&&r.status===400&&j?.failure?.type==='ValidationFailure'){
   e.definitive=true;e.code=/^[A-Z0-9_]{1,120}$/.test(j.failure.code||'')?j.failure.code:'PROVIDER_VALIDATION_REJECTED';e.providerFailureCode=e.code;
   await fs.appendFile(path.join(stateDir,'provider-rejections.jsonl'),JSON.stringify({at:new Date().toISOString(),idempotencyKey:key,http:r.status,failure:j.failure})+'\n',{mode:0o600});
  }
  throw e;
 }
 if(!j?.data||(r.status!==504&&j.success!==true))throw Error('DROPEA_SCHEMA_INVALID');
 return {http:r.status,data:j.data};
}
async function items(pathname){
 const all=[];
 for(let page=1;page<=100;page++){
  const {data}=await dropea(base+pathname+(pathname.includes('?')?'&':'?')+'limit=100&page='+page);
  if(!Array.isArray(data.items)||!data.pagination)throw Error('DROPEA_PAGE_INVALID');
  all.push(...data.items);
  if(data.pagination.has_next_page===false||data.pagination.total_pages<=page)return all;
 }
 throw Error('DROPEA_PAGE_LIMIT');
}
const shopify=createShopifyReadAuth(config);
const shopifyRoot=`https://${config.shopifyDomain}/admin/api/${config.shopifyApiVersion}/`;
async function source(url){
 if(!url.startsWith(shopifyRoot))throw Error('SHOPIFY_HOST_MISMATCH');
 const r=await shopify(url,{signal:AbortSignal.timeout(30_000)});
 if(!r.ok)throw Error('SHOPIFY_READ_'+r.status);
 const j=await r.json();return {data:j,link:r.headers.get('link')};
}
const readSource=async id=>(await source(shopifyRoot+`orders/${id}.json`)).data.order;
async function sources(){
 if(target)return [await readSource(target)];
 const all=[];let url=shopifyRoot+'orders.json?status=open&fulfillment_status=unfulfilled&limit=250';
 for(let page=0;url&&page<100;page++){
  const {data,link}=await source(url);
  if(!Array.isArray(data.orders))throw Error('SHOPIFY_PAGE_INVALID');all.push(...data.orders);
  url=link?.match(/<([^>]+)>; rel="next"/)?.[1]||null;
 }
 if(url)throw Error('SHOPIFY_PAGE_LIMIT');return all;
}
const stateDir=process.env.SHOPIFY_DROPEA_RECOVERY_STATE_DIR||path.resolve(config.dataDir,'shopify-dropea-recovery');
await fs.mkdir(stateDir,{recursive:true,mode:0o700});
const audit=entry=>fs.appendFile(path.join(stateDir,'actions.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});
const ledgerBase=orderId=>({storeId:'suleia',orderId,templateName:RECOVERY_TEMPLATE,provider:'dropea'});
async function claim(orderId,meta){
 const r=await claimTemplateDelivery(ledgerBase(orderId));
 if(r.acquired||!r.persistent)return r;
 const old=r.existing;
 // A changed payload may retry only a definitive pre-saga validation rejection.
 // An uncertain POST, operation in progress or unchanged body stays blocked.
 const correction=recoveryCorrection(old,meta);
 if(!correction)return {...r,reason:old?.last_error||r.reason};
 const rows=await updateRows('template_delivery_ledger',{status:'claimed',attempted_at:new Date().toISOString(),updated_at:new Date().toISOString()},{query:{template_key:'eq.'+old.template_key,status:'eq.provider_rejected',attempted_at:'eq.'+old.attempted_at,'raw->>digest':'eq.'+old.raw.digest},returning:'representation'});
 return {acquired:Array.isArray(rows)&&rows.length===1,persistent:true,reason:'validation_correction_claimed',idempotencyKey:correction.idempotencyKey};
}
const startedAt=new Date().toISOString();
const shop=(await dropea(base+'/dropshipper/shops/'+storeId)).data.shop;
if(shop?.id!==storeId||shop.name!=='Suleia'||shop.status!=='ACTIVE'||shop.store_type!=='SHOPIFY')throw Error('DROPEA_SHOP_MISMATCH');
const products=await items('/dropshipper/shops/'+storeId+'/products');
const carriers=(await dropea(base+'/dropshipper/catalogs/carriers')).data.items;
const orders=await sources(),results=[];
// One paginated recent-order snapshot avoids a request for every old Shopify
// order. Every possible creation still gets two fresh exact-reference reads.
const recentOrders=target?null:await items('/dropshipper/orders?store_id='+storeId+'&date_from='+encodeURIComponent(new Date(Date.now()-8*86400_000).toISOString()));
const byReference=new Map();
for(const o of recentOrders||[]){const ref=String(o.external_order_id||'').replace(/^#/,'');byReference.set(ref,[...(byReference.get(ref)||[]),o]);}
for(const order of orders){
 try{
  if(!target&&Date.now()-Date.parse(order.created_at)>7*86400_000){results.push({orderId:String(order.id),reference:order.name,status:'historical_review',reason:'STALE_ORDER_REQUIRES_REVIEW'});continue;}
  let lookupCount=0;
  results.push(await recoverShopifyOrder(order,{products,carriers,storeId,live,
   blocked:isBlockedCustomerOrder({customerPhone:order.shipping_address?.phone||order.phone},config.defaultStore),
   findExisting:reference=>!target&&lookupCount++===0&&byReference.has(reference.replace(/^#/,''))?Promise.resolve(byReference.get(reference.replace(/^#/,''))):items('/dropshipper/orders?store_id='+storeId+'&external_order_id='+encodeURIComponent(reference)),
   readSource,readCreated:async id=>(await dropea(base+'/dropshipper/orders/'+id)).data,
   createOrder:async (payload,key)=>{
    const r=await dropea(base+'/dropshipper/orders',{method:'POST',body:payload,key});
    if(r.http!==504)return r.data;
    if(r.data.operation_id!==key)throw Error('OPERATION_KEY_MISMATCH');
    for(let n=0;n<5;n++){
     const op=(await dropea(base+'/dropshipper/operations/'+encodeURIComponent(key))).data;
     if(op.status==='completed')return op.result;
     if(op.status==='failed'){const e=Error('DROPEA_CREATE_OPERATION_FAILED');e.code=e.message;throw e;}
     if(op.status!=='in_progress')throw Error('OPERATION_SCHEMA_INVALID');
     await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw Error('OPERATION_STILL_PENDING');
   },
   claim,
   finish:(orderId,patch)=>finishTemplateDelivery({...ledgerBase(orderId),...patch}),audit
  }));
 }catch(error){results.push({orderId:String(order.id),reference:order.name,status:'blocked',reason:/^[A-Z0-9_]{1,120}$/.test(error.message)?error.message:'RECOVERY_DEPENDENCY_FAILURE'});if(/DROPEA_HTTP_(401|403|429)/.test(error.message))break;}
}
const report={startedAt,completedAt:new Date().toISOString(),live,scanned:orders.length,coverageComplete:results.length===orders.length,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),results};
await fs.writeFile(path.join(stateDir,'latest.tmp'),JSON.stringify(report,null,2),{mode:0o600});
await fs.rename(path.join(stateDir,'latest.tmp'),path.join(stateDir,'latest.json'));
console.log(JSON.stringify(process.argv.includes('--summary')?{...report,results:results.filter(r=>!['already_present','historical_review'].includes(r.status))}:report,null,2));
if(!report.coverageComplete||results.some(r=>['blocked','duplicate_reference','applied_unverified','provider_rejected'].includes(r.status)&&r.reason!=='WAIT_NATIVE_IMPORT'))process.exitCode=2;
