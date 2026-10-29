import test from 'node:test';
import assert from 'node:assert/strict';
import { findIncidentDiscountShopifyOrders, incidentDiscountSourceAmountsMatch } from './incident-discount-shopify-read.mjs';

const old = { id:'gid://shopify/Order/123', name:'#2007', createdAt:'2026-08-01T08:00:00Z', customerPhone:'34600000001' };
const order = { raw:{external_order_id:'#2007'} };

test('older incident uses one bounded exact-reference read rather than the newest 250',async()=>{
 const calls=[];
 const result=await findIncidentDiscountShopifyOrders('600000001',order,{listOrders:async q=>{calls.push(q);return [old];}});
 assert.deepEqual(calls,[{first:2,query:'name:#2007'}]);assert.deepEqual(result,[old]);
});
test('source lookup rejects other references, mismatched phone and ambiguous exact identities',async()=>{
 for(const rows of [[{...old,name:'#20070'}],[{...old,customerPhone:'600000002'}],[old,{...old,id:'other'}],[]]){
  assert.deepEqual(await findIncidentDiscountShopifyOrders('600000001',order,{listOrders:async()=>rows}),[]);
 }
});
test('missing phone or unsafe reference cannot produce an unfiltered source lookup',async()=>{
 for(const [phone,reference] of [['','2007'],['600000001','2007 OR status:open'],['600000001','gid://not-approved']]){
  let reads=0;
  assert.deepEqual(await findIncidentDiscountShopifyOrders(phone,{raw:{external_order_id:reference}},{listOrders:async()=>{reads++;return [old];}}),[]);
  assert.equal(reads,0);
 }
});
test('reference-free legacy path retains bounded phone filtering',async()=>{
 let query;
 const result=await findIncidentDiscountShopifyOrders('600000001',{}, {listOrders:async q=>{query=q;return [old,{...old,customerPhone:'600000002'}];}});
 assert.deepEqual(query,{first:250});assert.deepEqual(result,[old]);
});
test('source economics block unknown, changed, non-EUR or cancelled orders',()=>{
 const d={orderAmount:29.99,currencyCode:'EUR'},s={totalAmount:29.99,currencyCode:'EUR'};
 assert.equal(incidentDiscountSourceAmountsMatch(d,s),true);
 for(const altered of [{totalAmount:null},{totalAmount:24.99},{currencyCode:'USD'},{cancelledAt:'2026-08-02T08:00:00Z'}]){
  assert.equal(incidentDiscountSourceAmountsMatch(d,{...s,...altered}),false);
 }
 assert.equal(incidentDiscountSourceAmountsMatch({},s),false);
 assert.equal(incidentDiscountSourceAmountsMatch({orderAmount:4,currencyCode:'EUR'},{...s,totalAmount:4}),false);
});
