import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCustomerCare,recordCustomerCareReceipt,customerCareEnvironment} from './customer-care-integration.mjs';
import {executeDeliveryReply} from './delivery-reply-executor.mjs';
const now=Date.parse('2026-10-30T13:00:00Z'),at=now-2*3600000;
const message={id:'10',type:'in',user_ns:'fixture',content:'Quiero el pedido el sábado',ts:at/1000};
const input={order:{orderId:'90001',createdAt:'2026-10-29T09:00:00Z',status:'ERROR'},incident:{orderId:'90001',incidenceId:'80001',incidenceDate:'2026-10-30T09:00:00Z',incidentType:'absent',chatbyUserNs:'fixture'},messages:[message]};
const control={customerCare:{enabled:true,context:true,clarification:true,mode:'CANARY',canaryCase:'90001:80001'}};
const memory=()=>{let current=null;return {load:async()=>current,save:async value=>{current={value,updated_at:value.updated_at};return current;}};};
test('disabled and SHADOW paths preserve the exact legacy plan, even on memory failure',async()=>{
 const legacy={eligible:true,kind:'CLARIFY',hash:'legacy',content:'old'};
 const failure={load:async()=>{throw Error('offline');}};
 for(const c of [{},{customerCare:{enabled:true,context:true,mode:'SHADOW'}}])assert.equal((await prepareCustomerCare(legacy,input,{control:c,store:failure,now})).plan,legacy);
 const a=await prepareCustomerCare(legacy,input,{control,store:failure,now});assert.equal(a.plan.eligible,false);
});
test('legacy solution/action plans are preserved across all capability modes',async()=>{
 for(const mode of ['SHADOW','CANARY','LIVE']){const legacy={eligible:true,kind:'SOLUTION',hash:'original'};assert.equal((await prepareCustomerCare(legacy,input,{control:{customerCare:{...control.customerCare,mode}},store:memory(),now})).plan,legacy);}
});
test('same transcript gives stable revalidation hash despite elapsed processing time',async()=>{
 const store=memory(),legacy={eligible:true,kind:'CLARIFY'};
 const a=await prepareCustomerCare(legacy,input,{control,store,now});
 const b=await prepareCustomerCare(legacy,input,{control,store,now:now+1000});
 assert.equal(a.plan.hash,b.plan.hash);assert.match(a.plan.content,/mañana o por la tarde/);
});
test('uncertain send receipt blocks every later cycle, even after hours pass',async()=>{
 const store=memory(),legacy={eligible:true,kind:'CLARIFY'};const a=await prepareCustomerCare(legacy,input,{control,store,now});
 await recordCustomerCareReceipt(a.plan,{status:'delivery_unverified',attemptedAt:new Date(now).toISOString(),raw:{}},{store});
 const b=await prepareCustomerCare(legacy,input,{control,store,now:now+4*3600000});assert.equal(b.plan.eligible,false);assert.equal(b.care.next_best_action,'WAITING_CUSTOMER');
});
test('existing sender never sends after a late cancellation changes the plan',async()=>{
 const store=memory(),legacy={eligible:true,kind:'CLARIFY'};const a=await prepareCustomerCare(legacy,input,{control,store,now});let sends=0;
 const result=await executeDeliveryReply(a.plan,{revalidate:async()=> (await prepareCustomerCare(legacy,{...input,messages:[message,{...message,id:'11',content:'No quiero el pedido',ts:(at+60000)/1000}]},{control,store,now})).plan,send:async()=>{sends++;}});
 assert.equal(result.status,'BLOCKED');assert.equal(sends,0);
});
test('AI cannot be enabled through private controls',()=>assert.equal(customerCareEnvironment({customerCare:{ai:true}}).CUSTOMER_CARE_AI_INTERPRETER_ENABLED,'false'));
