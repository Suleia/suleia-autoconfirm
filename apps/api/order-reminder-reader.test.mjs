import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrderReminderReader} from './order-reminder-reader.mjs';
test('reminder status is GET-only, coalesced, contact-free and explicitly read-only',async()=>{
 let calls=0;const reader=createOrderReminderReader({now:()=>Date.parse('2026-10-25T12:00Z'),request:async(path,options)=>{
  calls++;assert.equal(path,'/api/order-reminder/status');assert.equal(options.method,'GET');
  return {ok:true,reminder:{enabled:true,mode:'LIVE',at:'2026-10-25T11:59:00Z',counts:{reminder_verified:1,eligible:3},results:[{phone:'should-not-cross'}],canary:{state:'VERIFIED',orderId:'private-order'},owner:'private-config'}};
 }});
 const [a,b]=await Promise.all([reader(),reader()]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.state,'FRESH');assert.equal(a.externalWrites,0);assert.equal(a.counts.reminder_verified,1);assert.equal(a.counts.reminder_customer_responded,null);assert.equal(JSON.stringify(a).includes('private-order'),false);assert.equal(JSON.stringify(a).includes('should-not-cross'),false);await reader();assert.equal(calls,1);
});
test('unavailable or missing reader configuration never fabricates zeros',async()=>{assert.equal((await createOrderReminderReader({})()).state,'NOT_CONFIGURED');const r=await createOrderReminderReader({request:async()=>{throw Error('offline');}})();assert.equal(r.state,'READ_UNAVAILABLE');assert.equal(r.available,false);assert.equal(r.counts,undefined);});
test('old cycle is labeled stale even if upstream claims LIVE',async()=>{const r=await createOrderReminderReader({now:()=>Date.parse('2026-10-25T12:00Z'),request:async()=>({ok:true,reminder:{enabled:true,mode:'LIVE',at:'2026-10-25T10:00Z',counts:{eligible:1}}})})();assert.equal(r.state,'STALE');});
