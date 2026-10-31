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

test('V3 SHADOW stores its own namespace and returns the exact legacy plan',async()=>{
 const legacy={eligible:true,kind:'CLARIFY',hash:'existing',content:'existing'};
 const v3Store=memory();let oldReads=0;
 const result=await prepareCustomerCare(legacy,input,{control:{conversationV3:{enabled:true,mode:'SHADOW'}},v3Store,store:{load:async()=>{oldReads++;throw Error('must not load old memory');}},now});
 assert.equal(result.plan,legacy);assert.equal(result.care.version,'CONVERSATION_V3');assert.equal((await v3Store.load()).value.version,'CONVERSATION_V3');assert.equal(oldReads,0);
});
test('V3 cannot replace a legacy solution, even with requested global LIVE',async()=>{
 const legacy={eligible:true,kind:'SOLUTION',hash:'existing'};
 const result=await prepareCustomerCare(legacy,input,{control:{conversationV3:{enabled:true,mode:'LIVE',clarification:true}},v3Store:memory(),now});
 assert.equal(result.plan,legacy);
});
test('V3 observation failure preserves normal work and blocks only its selected canary',async()=>{
 const legacy={eligible:true,kind:'CLARIFY'},v3Store={load:async()=>{throw Error('private database unavailable');}};
 for(const mode of ['SHADOW','LIVE'])assert.equal((await prepareCustomerCare(legacy,input,{control:{conversationV3:{enabled:true,mode}},v3Store,now})).plan,legacy);
 const result=await prepareCustomerCare(legacy,input,{control:{conversationV3:{enabled:true,mode:'CANARY',canaryCase:'90001:80001'}},v3Store,now});
 assert.equal(result.plan.eligible,false);assert.equal(result.plan.reason,'V3_MEMORY_UNAVAILABLE');
});
test('V3 receipt preserves audit history and never promotes an uncertain send',async()=>{
 const v3Store=memory(),legacy={eligible:true,kind:'CLARIFY'};
 const result=await prepareCustomerCare(legacy,input,{control:{conversationV3:{enabled:true,mode:'SHADOW'}},v3Store,now});
 const plan={orderId:'90001',issueId:'80001',conversationId:'fixture',content:'synthetic clarification',care_capability:'CONTEXTUAL_CLARIFICATION',care_plan:{...result.care,response_type:'CLARIFICATION',missing_slots:['TIME_WINDOW']}};
 await recordCustomerCareReceipt(plan,{status:'delivery_unverified',attemptedAt:new Date(now).toISOString(),raw:{}},{store:v3Store});
 const value=(await v3Store.load()).value;
 assert.equal(value.version,'CONVERSATION_V3');assert.equal(value.clarifications.at(-1).status,'DELIVERY_UNVERIFIED');assert.equal(value.waiting_for_customer,true);assert.ok(value.fact_ledger.length);
 const again=await prepareCustomerCare(legacy,input,{control:{conversationV3:{enabled:true,mode:'SHADOW'}},v3Store,now:now+3600000});
 assert.equal(again.care.customer_reply_action,'NONE');assert.equal(again.plan,legacy);
});

const preCanary={real_cases:380,reviewed_real_cases:345,provenance_verified:true,wrong_irreversible_route:0,wrong_order_binding:0,repeated_clarification:0,owner_routing:1,explicit_return_recall:1,explicit_order_recall:1,date_window_accuracy:.99,current_replay_verified:true,executor_reconciliation_contract_verified:true,unknown_execution_no_blind_retry_tests:true};
const v3Control={conversationV3:{enabled:true,mode:'CANARY',clarification:true,statusReply:false,canaryCase:'90001:80001',releaseReport:preCanary}};
const v3Input={...input,incident:{...input.incident,chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},issue:{raw:{id:80001,order_id:90001,status:'PENDING',is_active:true,allowed_resolution_options:['RETRY_DELIVERY']}}};
test('V3 uses the existing pre-send journal and never repeats an uncertain send after later cycles',async()=>{
 const store=memory(),legacy={eligible:true,kind:'CLARIFY'},trace=[];let ledger=null,sends=0;
 const prepare=async currentNow=>prepareCustomerCare(legacy,v3Input,{control:v3Control,v3Store:store,now:currentNow});
 const first=await prepare(now);assert.equal(first.plan.eligible,true);assert.equal(first.care.missing_information.length,1);
 const deps={revalidate:async()=> (await prepare(now)).plan,readMessages:async()=>[message],now:()=>now,
  claimMessage:async()=>ledger?{persistent:true,acquired:false,existing:ledger}:{persistent:true,acquired:true},
  finishMessage:async receipt=>{trace.push(receipt.status);ledger={status:receipt.status,attempted_at:receipt.attemptedAt,raw:receipt.raw};await recordCustomerCareReceipt(first.plan,receipt,{store});return receipt;},
  send:async()=>{assert.equal(ledger.status,'delivery_unverified');assert.equal((await store.load()).value.waiting_for_customer,true);trace.push('POST');sends++;throw Error('connection lost after provider accepted');}};
 const result=await executeDeliveryReply(first.plan,deps);assert.equal(result.status,'RECONCILE');assert.equal(sends,1);
 assert.ok(trace.indexOf('delivery_unverified')<trace.indexOf('POST'));
 for(const age of [30*60000,3*3600000,25*3600000]){
  const next=await prepare(now+age);assert.equal(next.care.next_best_action,'WAITING_CUSTOMER');
  await executeDeliveryReply(next.plan,deps);assert.equal(sends,1);
 }
});
test('V3 cannot post if durable journal persistence fails',async()=>{
 const store=memory(),legacy={eligible:true,kind:'CLARIFY'};
 const first=await prepareCustomerCare(legacy,v3Input,{control:v3Control,v3Store:store,now});let sends=0;
 await assert.rejects(executeDeliveryReply(first.plan,{revalidate:async()=>first.plan,readMessages:async()=>[message],claimMessage:async()=>({persistent:true,acquired:true}),finishMessage:async()=>{throw Error('durable journal unavailable');},send:async()=>{sends++;}}));
 assert.equal(sends,0);
});
test('V3 one verified clarification persists the provider WAMID and consumes only a natural inbound',async()=>{
 const store=memory(),legacy={eligible:true,kind:'CLARIFY'};
 const first=await prepareCustomerCare(legacy,v3Input,{control:v3Control,v3Store:store,now});let sent=false,sends=0;
 const outbound={id:'20',type:'agent',user_ns:'fixture',content:first.plan.content,ts:now/1000,mid:'wamid.v3-regression'};
 const result=await executeDeliveryReply(first.plan,{revalidate:async()=>first.plan,now:()=>now,readMessages:async()=>sent?[message,outbound]:[message],
  claimMessage:async()=>({persistent:true,acquired:true}),finishMessage:async receipt=>{await recordCustomerCareReceipt(first.plan,receipt,{store});return receipt;},
  send:async()=>{sends++;sent=true;return {mid:'wamid.v3-regression'};}});
 assert.equal(sends,1);assert.equal(result.status,'VERIFIED');assert.equal((await store.load()).value.clarifications.at(-1).provider_message_id,'wamid.v3-regression');
 const waiting=await prepareCustomerCare(legacy,{...v3Input,messages:[message,outbound]},{control:v3Control,v3Store:store,now:now+30*60000});
 assert.equal(waiting.care.next_best_action,'WAITING_CUSTOMER');assert.equal(waiting.plan.eligible,false);
 const answer={id:'21',type:'in',user_ns:'fixture',content:'Por la tarde',ts:(now+3600000)/1000};
 const answered=await prepareCustomerCare(legacy,{...v3Input,messages:[message,outbound,answer]},{control:v3Control,v3Store:store,now:now+2*3600000});
 assert.equal(answered.care.delivery_window,'AFTERNOON');assert.ok(answered.care.clarifications.every(c=>c.answered_at));assert.equal(answered.care.customer_reply_action,'NONE');
 assert.equal(sends,1);
});
