import test from 'node:test';import assert from 'node:assert/strict';
import {prepareCustomerCare,recordCustomerCareReceipt,verifyConversationV3Dispatch} from './customer-care-integration.mjs';
import {admitConversationV3,recordConversationV3Release,verifyConversationV3Admission,disableConversationV3Replies} from './conversation-v3-release.mjs';
import {executeDeliveryReply} from './delivery-reply-executor.mjs';
import {conversationV3DeliveryPlan} from './delivery-reply-policy.mjs';
import {liveCarePolicy} from '../../autoconfirm/src/customer-context/live-policy.mjs';
import {compileCustomerCase} from '../../autoconfirm/src/customer-context/case-compiler.mjs';
const now=Date.parse('2026-10-31T11:00:00Z'),at=now-2*3600000;
const msg=(content,id=1,type='in')=>({id:String(id),user_ns:'fixture-live',type,content,ts:(at+id*1000)/1000,...(type==='out'?{mid:'wamid.fixture.'+id}:{})});
const input=(texts=['¿Dónde está mi pedido?'])=>({now,order:{orderId:'90001',status:'ERROR',orderAmount:29.99,createdAt:'2026-10-29T09:00:00Z',raw:{id:90001,status:'ERROR',sub_status:'DELIVERY_EXCEPTION',total_amount:29.99,currency:'EUR',payment_method:'COD'}},issue:{raw:{id:80001,order_id:90001,status:'PENDING',is_active:true,allowed_resolution_options:['PROVIDE_SOLUTION','RETRY_DELIVERY']}},incident:{orderId:'90001',incidenceId:'80001',incidenceDate:'2026-10-30T08:00:00Z',incidentType:'absent',chatbyUserNs:'fixture-live',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},messages:texts.map((t,i)=>typeof t==='string'?msg(t,i+1):t),binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'fixture-live'},freshProof:{orderReadAt:new Date(now).toISOString(),conversationReadAt:new Date(now).toISOString(),exactConversationVerified:true}});
const report={real_cases:380,reviewed_real_cases:345,provenance_verified:true,wrong_irreversible_route:0,wrong_order_binding:0,repeated_clarification:0,owner_routing:1,explicit_return_recall:1,explicit_order_recall:1,date_window_accuracy:.99,current_replay_verified:true,executor_reconciliation_contract_verified:true,unknown_execution_no_blind_retry_tests:true};
const control={conversationV3:{enabled:true,mode:'LIVE',authorizationRef:'OWNER-LIVE',clarification:true,statusReply:true,semantic:false,paymentMethods:['CASH','CARD'],releaseReport:report}};
function memory(){let row=null;return {load:async()=>row,save:async value=>{row={value,updated_at:value.updated_at};return row;}};}
function ledger(){const rows=new Map(),id=a=>[a.storeId,a.orderId,a.templateName].join('|');let version=0;return {rows,get:async a=>rows.get(id(a))||null,claim:async a=>{const k=id(a);if(rows.has(k))return {acquired:false,persistent:true,existing:rows.get(k)};const row={template_key:k,status:'claimed',updated_at:String(++version)};rows.set(k,row);return {acquired:true,persistent:true,row};},finish:async a=>{const k=id(a),row={...rows.get(k),...a,template_key:k,updated_at:String(++version)};rows.set(k,row);return [row];},cas:async(_,patch,options)=>{const k=options.query.template_key.slice(3),row=rows.get(k);if(!row||'eq.'+row.status!==options.query.status||'eq.'+row.updated_at!==options.query.updated_at)return [];const next={...row,...patch,updated_at:String(++version)};rows.set(k,next);return [next];}};}
async function prepare(x=input(),store=memory(),deps=ledger()){return {result:await prepareCustomerCare({eligible:false,reason:'NO_DELIVERY_REQUEST'},x,{control,v3Store:store,releaseDeps:deps,now}),store,deps,x};}
test('first natural status case is durably pinned; another case cannot become a parallel canary',async()=>{
 const {result,deps}=await prepare();assert.equal(result.plan.eligible,true);assert.equal(result.plan.care_admission.stage,'CANARY');
 const other={...result.plan,orderId:'90002'};assert.equal(await admitConversationV3(other,control.conversationV3,deps),null);
 await recordConversationV3Release(result.plan,{status:'delivery_unverified'},control.conversationV3,deps);
 assert.equal(await admitConversationV3(result.plan,control.conversationV3,deps),null);
 await verifyConversationV3Admission(result.plan,control.conversationV3,deps);
});
test('only the exact one-POST provider receipt and readback promotes its capability',async()=>{
 const {result,deps}=await prepare(),plan=result.plan;
 await recordConversationV3Release(plan,{status:'delivery_unverified'},control.conversationV3,deps);
 await recordConversationV3Release(plan,{status:'sent',raw:{messageId:'wamid.synthetic',providerReceipt:true,readbackVerified:true,beforeDispatchVerified:true,sendAttempts:1}},control.conversationV3,deps);
 const promoted=await admitConversationV3({...plan,orderId:'90002'},control.conversationV3,deps);assert.equal(promoted.stage,'PROMOTED');
 const clarification={...plan,care_capability:'CONTEXTUAL_CLARIFICATION',care_plan:{...plan.care_plan,missing_information:['TIME_WINDOW']}};
 assert.equal((await admitConversationV3(clarification,control.conversationV3,deps)).stage,'CANARY');
});
test('unknown sends remain pinned across subsequent cycles; a proven no-POST abort can admit another case',async()=>{
 const a=await prepare(),plan=a.result.plan;
 await recordConversationV3Release(plan,{status:'delivery_unverified'},control.conversationV3,a.deps);
 assert.equal(await admitConversationV3({...plan,orderId:'90002'},control.conversationV3,a.deps),null);
 await recordConversationV3Release(plan,{status:'aborted',raw:{notSent:true}},control.conversationV3,a.deps);
 assert.equal((await admitConversationV3({...plan,orderId:'90002'},control.conversationV3,a.deps)).stage,'CANARY');
});
test('P0 disables both reply capabilities through the existing ledger and preserves case memory',async()=>{
 const a=await prepare();await disableConversationV3Replies('WRONG_ORDER_BINDING',a.result.plan,a.deps);
 assert.equal(await admitConversationV3(a.result.plan,control.conversationV3,a.deps),null);
 assert.ok((await a.store.load()).value.fact_ledger.length);await assert.rejects(()=>verifyConversationV3Admission(a.result.plan,control.conversationV3,a.deps),/P0_REPLY_BREAKER/);
});
test('final dispatch allows only its own journal and aborts changed amount, customer message or owner',async()=>{
 const a=await prepare(),plan=a.result.plan;await recordCustomerCareReceipt(plan,{status:'delivery_unverified',attemptedAt:new Date(now).toISOString()},{store:a.store});
 const x=structuredClone(a.x);x.policy=liveCarePolicy(x,{now,paymentMethods:['CASH','CARD'],authorizationRef:'OWNER-LIVE'});
 assert.ok(verifyConversationV3Dispatch(plan,x,(await a.store.load()).value).expiresAt>now);
 const persisted=(await a.store.load()).value;
 for(const change of [x=>x.order.raw.total_amount=x.order.orderAmount=24.99,x=>x.messages.push(msg('No quiero el pedido',9)),x=>x.sharedIssueReceipt={status:'applied_unverified'}]){
  const b=structuredClone(a.x);change(b);b.policy=liveCarePolicy(b,{now,paymentMethods:['CASH','CARD'],authorizationRef:'OWNER-LIVE'});
  assert.throws(()=>verifyConversationV3Dispatch(plan,b,persisted),/STALE_PLAN|OWNER_IN_FLIGHT/);
 }
});
test('the live sender journals before its single POST and never invokes a second send for an unknown result',async()=>{
 const a=await prepare(),plan=a.result.plan;let messageClaim=null,sends=0;const trace=[];
 const deps={guardedDispatch:true,initialMessages:[],revalidate:async()=>{throw Error('redundant pre-read');},readMessages:async()=>[],claimMessage:async()=>{if(messageClaim)return {persistent:true,acquired:false,existing:messageClaim};messageClaim={status:'claimed'};return {persistent:true,acquired:true};},finishMessage:async receipt=>{trace.push(receipt.status);messageClaim=receipt;await recordCustomerCareReceipt(plan,receipt,{store:a.store});await recordConversationV3Release(plan,receipt,control.conversationV3,a.deps);return [receipt];},send:async()=>{trace.push('POST');sends++;throw Error('timeout');}};
 assert.equal((await executeDeliveryReply(plan,deps)).status,'RECONCILE');assert.equal(trace[0],'delivery_unverified');assert.equal(sends,1);
 assert.equal((await executeDeliveryReply(plan,deps)).status,'RECONCILE');assert.equal(sends,1);
});
test('context completes a split date/window only through the existing PROVIDE_SOLUTION owner',()=>{
 const x=input(['Sí quiero recibir el pedido','el lunes','por la tarde','llámame antes']);x.policy=liveCarePolicy(x,{now,paymentMethods:['CASH','CARD'],authorizationRef:'OWNER-LIVE'});
 const c=compileCustomerCase(x),legacy={eligible:false,reason:'V3_DELEGATED_TO_EXISTING_OWNER'},p=conversationV3DeliveryPlan(legacy,x,c);
 assert.equal(p.eligible,true);assert.equal(p.kind,'SOLUTION');assert.equal(p.v3_delegation.owner,'existing_incident_action_gateway');assert.match(p.note,/2026-11-02|tarde/);assert.match(p.note,/llamen antes/);assert.equal(p.acknowledgement,null);
 x.issue.raw.allowed_resolution_options=[];assert.throws(()=>conversationV3DeliveryPlan(legacy,x,c),/STALE_PLAN/);
});

test('a real clarification receipt blocks following cycles until the customer answers the missing fact',async()=>{
 const a=await prepare(input(['Sí quiero recibirlo el lunes'])),p=a.result.plan;
 assert.equal(p.care_capability,'CONTEXTUAL_CLARIFICATION');assert.equal(p.eligible,true);
 await recordCustomerCareReceipt(p,{status:'sent',sentAt:new Date(now).toISOString(),raw:{messageId:'wamid.question'}},{store:a.store});
 const second=await prepareCustomerCare({eligible:false,reason:'NO_DELIVERY_REQUEST'},a.x,{control,v3Store:a.store,releaseDeps:a.deps,now:now+60000});
 assert.equal(second.plan.eligible,false);assert.equal(second.care.next_best_action,'WAITING_CUSTOMER');
 const reply=msg('Por la tarde',8);reply.ts=(now+120000)/1000;
 const answered={...a.x,now:now+2*3600000,messages:[...a.x.messages,reply]};
 answered.freshProof={orderReadAt:new Date(answered.now).toISOString(),conversationReadAt:new Date(answered.now).toISOString(),exactConversationVerified:true};
 const third=await prepareCustomerCare({eligible:false,reason:'NO_DELIVERY_REQUEST'},answered,{control,v3Store:a.store,releaseDeps:a.deps,now:answered.now});
 assert.equal(third.care.delivery_window,'AFTERNOON');assert.equal(third.care.customer_reply_action,'NONE');assert.equal(third.care.operational_action,'RETRY_DELIVERY');
 assert.ok(third.care.clarifications[0].answered_at);
});

test('post-read distinguishes unchanged input from a confirmed stale write and duplicate reply; P0 blocks promotion',async()=>{
 for(const fault of ['none','new_inbound_before_post','edited_inbound','new_inbound_after_post','duplicate']){
  const a=await prepare(),p=a.result.plan;let sends=0;
  const sentAt=new Date(now+1000).toISOString();
  const reply={...msg(p.content,50,'out'),ts:(now+2000)/1000,mid:'wamid.reply'};
  const history=[...a.x.messages,reply];
  if(fault==='new_inbound_before_post')history.push({...msg('No quiero el pedido',9),ts:now/1000});
  if(fault==='new_inbound_after_post')history.push({...msg('No quiero el pedido',9),ts:(now+3000)/1000});
  if(fault==='edited_inbound')history[0]={...history[0],content:'No quiero el pedido'};
  if(fault==='duplicate')history.push({...reply,id:'51',mid:'wamid.duplicate'});
  const result=await executeDeliveryReply(p,{guardedDispatch:true,initialMessages:a.x.messages,now:()=>now,readMessages:async()=>history,
   claimMessage:async()=>({acquired:true,persistent:true}),finishMessage:async receipt=>{await recordConversationV3Release(p,receipt,control.conversationV3,a.deps);return [receipt];},
   send:async()=>{sends++;return {mid:'wamid.reply',user_ns:p.conversationId,v3_dispatch_verified:true,v3_dispatched_at:sentAt};}});
  assert.equal(sends,1);
  const failed=['new_inbound_before_post','edited_inbound','duplicate'].includes(fault);
  assert.equal(result.status,failed?'RECONCILE':'VERIFIED',fault);
  assert.equal(result.p0_code,fault==='duplicate'?'DUPLICATE_V3_MESSAGE':['new_inbound_before_post','edited_inbound'].includes(fault)?'CONFIRMED_STALE_PLAN_WRITE':null,fault);
  assert.equal(!!await admitConversationV3({...p,orderId:'90002'},control.conversationV3,a.deps),!failed,fault);
 }
});

test('concurrent natural admission grants one persistent canary only',async()=>{
 const deps=ledger(),a=await prepare(input(),memory(),deps),p=a.result.plan;
 const other={...p,orderId:'90002'};
 const results=await Promise.all([admitConversationV3(p,control.conversationV3,deps),admitConversationV3(other,control.conversationV3,deps)]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(results[0].case_key,'90001:80001');
});
