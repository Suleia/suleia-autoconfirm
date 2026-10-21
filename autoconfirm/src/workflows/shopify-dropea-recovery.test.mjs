import test from 'node:test';
import assert from 'node:assert/strict';
import {planShopifyDropeaRecovery as plan,recoverShopifyOrder,verifyRecoveredOrder,recoveryCorrection,collectDropeaPages} from './shopify-dropea-recovery.mjs';
const now=Date.parse('2026-10-21T12:00:00Z');
const order=()=>({id:123,name:'#123',created_at:'2026-10-21T09:00:00Z',currency:'EUR',financial_status:'pending',payment_gateway_names:['Cash on Delivery (COD)'],email:'fixture@example.invalid',total_price:'29.99',shipping_address:{first_name:'Fixture',last_name:'Example',address1:'Example Street',address2:'Test',city:'Madrid',province:'Madrid',zip:'28001',country_code:'ES',phone:'+34600000000'},line_items:[{sku:'TEST',quantity:2,current_quantity:2,price:'29.99',requires_shipping:true,discount_allocations:[{amount:'29.99'}]}]});
const products=[{id:1,owner_id:7,variants:[{variant_id:8,sku:'TEST',stock:100}]}];
const carriers=[{code:'GLS',services:[{code:'96|18',is_active:true}]}];
const opts={storeId:10,now};
test('pagination continues beyond a provider count limited to current page',async()=>{
 const visited=[];const rows=await collectDropeaPages(async page=>{visited.push(page);return {items:page===1?[{id:1},{id:2}]:page===2?[{id:3},{id:4}]:[{id:5}],pagination:{page,total:2,total_pages:1}};},{limit:2});
 assert.deepEqual(rows.map(x=>x.id),[1,2,3,4,5]);assert.deepEqual(visited,[1,2,3]);
});
test('repeated pages fail closed instead of looping or claiming full coverage',async()=>{await assert.rejects(collectDropeaPages(async()=>({items:[{id:1}],pagination:{total_pages:1}}),{limit:1}),/DROPEA_PAGE_REPEAT/);});
const fixturePlan=()=>plan(order(),products,carriers,opts);
function actual(p){return {id:9,status:'PENDING',store_id:10,external_order_id:'#123',payment_method:'COD',currency:'EUR',total_amount:29.99,line_items:p.payload.line_items,shipping_address:{...p.payload.customer_details.shipping_address,email:p.payload.customer_details.email,phone_number:p.payload.customer_details.phone}};}
test('COD pack preserves both units and exact discounted cents',()=>{const p=fixturePlan();assert.equal(p.eligible,true);assert.deepEqual(p.payload.line_items,[{variant_id:8,quantity:1,unit_price:14.99},{variant_id:8,quantity:1,unit_price:15}]);assert.equal(p.expectedCents,2999);assert.equal(p.payload.customer_details.shipping_address.postal_code,'28001');});
for(const [name,patch,reason] of [
 ['cancelled',{cancelled_at:'2026-10-21'},'SOURCE_NOT_OPEN_UNFULFILLED'],
 ['closed',{closed_at:'2026-10-21'},'SOURCE_NOT_OPEN_UNFULFILLED'],
 ['fulfilled',{fulfillment_status:'fulfilled'},'SOURCE_NOT_OPEN_UNFULFILLED'],
 ['refunded',{refunds:[{}]},'SOURCE_NOT_OPEN_UNFULFILLED'],
 ['unpaid non-COD',{payment_gateway_names:['other']},'PAYMENT_NOT_ELIGIBLE'],
 ['too new',{created_at:'2026-10-21T11:50:00Z'},'WAIT_NATIVE_IMPORT'],
 ['old',{created_at:'2026-09-01T09:00:00Z'},'STALE_ORDER_REQUIRES_REVIEW'],
 ['shipping charge',{total_price:'34.99'},'TOTAL_NOT_REPRESENTABLE'],
 ['invalid email',{email:'invalid'},'EMAIL_INVALID'],
 ['partial quantity',{line_items:[{sku:'TEST',quantity:2,current_quantity:1,price:'29.99'}]},'LINE_REQUIRES_REVIEW']
])test('blocks '+name,()=>{assert.equal(plan({...order(),...patch},products,carriers,opts).reason,reason);});
test('unknown and ambiguous SKUs block without substitution',()=>{assert.equal(plan(order(),[],carriers,opts).reason,'SKU_MAPPING_NOT_UNIQUE');assert.equal(plan(order(),[...products,...products],carriers,opts).reason,'SKU_MAPPING_NOT_UNIQUE');});
test('COD without email uses native provider routing alias without editing source',()=>{const o={...order(),email:null};const p=plan(o,products,carriers,opts);assert.equal(p.eligible,true);assert.equal(p.payload.customer_details.email,'34600000000@dropea.io');assert.equal(o.email,null);assert.equal(p.technicalContact,true);});
test('blocked customers and island services stay blocked',()=>{assert.equal(plan(order(),products,carriers,{...opts,blocked:true}).reason,'BLOCKED_CUSTOMER');const o=order();o.shipping_address.zip='07001';assert.equal(plan(o,products,carriers,opts).reason,'NON_MAINLAND_SERVICE_REQUIRES_REVIEW');});
test('postcondition detects amount, quantity, reference and address changes',()=>{const p=fixturePlan(),a=actual(p);assert.equal(verifyRecoveredOrder(a,p),true);for(const changed of [{total_amount:30},{store_id:11},{external_order_id:'#124'},{line_items:[{variant_id:8,quantity:1}]},{shipping_address:{...a.shipping_address,postal_code:'28002'}},{status:'ERROR'}])assert.equal(verifyRecoveredOrder({...a,...changed},p),false);});
function deps(extra={}){const counts={posts:0,claims:0,audits:[]},p=fixturePlan();return {counts,config:{products,carriers,...opts,live:true,readSource:async()=>order(),findExisting:async()=>[],readCreated:async()=>actual(p),createOrder:async()=>{counts.posts++;return {id:9};},claim:async()=>{counts.claims++;return {acquired:true,persistent:true};},finish:async()=>{},audit:async e=>counts.audits.push(e),...extra}};}
test('existing references never create or claim',async()=>{const d=deps({findExisting:async()=>[{id:9}]});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'already_present');assert.equal(d.counts.posts,0);assert.equal(d.counts.claims,0);});
test('historical imported orders are reconciled before the creation age gate',async()=>{const d=deps({findExisting:async()=>[{id:9}]});assert.equal((await recoverShopifyOrder({...order(),created_at:'2020-01-01T00:00:00Z'},d.config)).status,'already_present');assert.equal(d.counts.posts,0);});
test('dry-run has no writes',async()=>{const d=deps({live:false});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'ready');assert.equal(d.counts.claims,0);assert.equal(d.counts.posts,0);});
test('persistent claim required',async()=>{const d=deps({claim:async()=>({acquired:true,persistent:false})});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'blocked');assert.equal(d.counts.posts,0);});
test('changed source blocks after claim',async()=>{const d=deps({readSource:async()=>({...order(),cancelled_at:'2026-10-21'})});assert.equal((await recoverShopifyOrder(order(),d.config)).reason,'SOURCE_CHANGED');assert.equal(d.counts.posts,0);});
test('native import race reconciles without POST',async()=>{let n=0;const d=deps({findExisting:async()=>++n===1?[]:[{id:9}]});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'already_present');assert.equal(d.counts.posts,0);});
test('uncertain transport never replays a POST',async()=>{let posts=0;const d=deps({createOrder:async()=>{posts++;throw Error('timeout');}});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'applied_unverified');assert.equal(posts,1);assert.equal(d.counts.audits.length,2);});
test('fresh GET plus unique lookup required for verified',async()=>{let n=0;const d=deps({findExisting:async()=>++n<3?[]:[{id:9}]});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'verified');assert.equal(d.counts.posts,1);assert.equal(d.counts.audits[0].result,'attempted');});
test('duplicate after creation is never called verified',async()=>{let n=0;const d=deps({findExisting:async()=>++n<3?[]:[{id:9},{id:10}]});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'applied_unverified');});
test('definitive provider validation differs from an uncertain transport',async()=>{const d=deps({createOrder:async()=>{const e=Error('rejected');e.code='PROVIDER_VALIDATION_REJECTED';e.definitive=true;throw e;}});assert.equal((await recoverShopifyOrder(order(),d.config)).status,'provider_rejected');});
test('postal coverage rejects may retry at most hourly after definitive failure',()=>{
 const meta={digest:'same',idempotencyKey:'stable'};
 const previous={status:'provider_rejected',attempted_at:new Date(now-3600_000).toISOString(),raw:{digest:'same',definitive:true,providerFailureCode:'POSTAL_CODE_NOT_COVERED'}};
 assert.ok(recoveryCorrection(previous,meta,now).idempotencyKey.startsWith('stable-coverage-'));
 assert.equal(recoveryCorrection({...previous,attempted_at:new Date(now-3599_000).toISOString()},meta,now),null);
 assert.equal(recoveryCorrection({...previous,status:'applied_unverified'},meta,now),null);
 assert.equal(recoveryCorrection({...previous,raw:{...previous.raw,definitive:false}},meta,now),null);
 assert.equal(recoveryCorrection({...previous,raw:{...previous.raw,providerFailureCode:'OTHER'}},meta,now),null);
 assert.deepEqual(recoveryCorrection(previous,{...meta,digest:'corrected'},now),{idempotencyKey:'stable'});
});
