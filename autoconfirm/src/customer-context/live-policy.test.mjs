import test from 'node:test';import assert from 'node:assert/strict';
import {liveCarePolicy} from './live-policy.mjs';
import {compileCustomerCase,readCompiledIntent} from './case-compiler.mjs';
import {decorateConversationV3} from './sender-adapter.mjs';
const now=Date.parse('2026-10-31T11:00:00Z'),at=now-2*3600000;
const msg=(content,id=1,type='in')=>({id:String(id),user_ns:'fixture-live',type,content,ts:(at+id*1000)/1000,...(type==='out'?{mid:'wamid.fixture.'+id}:{})});
const fixture=(texts=['¿Dónde está mi pedido?'])=>({now,order:{orderId:'90001',status:'ERROR',orderAmount:29.99,createdAt:'2026-10-29T09:00:00Z',raw:{id:90001,status:'ERROR',sub_status:'DELIVERY_EXCEPTION',total_amount:29.99,currency:'EUR',payment_method:'COD'}},issue:{raw:{id:80001,order_id:90001,status:'PENDING',is_active:true,allowed_resolution_options:['PROVIDE_SOLUTION','RETRY_DELIVERY']}},incident:{orderId:'90001',incidenceId:'80001',incidenceDate:'2026-10-30T08:00:00Z',incidentType:'absent',chatbyUserNs:'fixture-live',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},messages:texts.map((t,i)=>typeof t==='string'?msg(t,i+1):t),binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'fixture-live'},freshProof:{orderReadAt:new Date(now).toISOString(),conversationReadAt:new Date(now).toISOString(),exactConversationVerified:true}});
const policy=(input,extra={})=>liveCarePolicy(input,{now:input.now,paymentMethods:['CASH','CARD'],authorizationRef:'OWNER-LIVE',...extra});
const report={real_cases:380,reviewed_real_cases:345,provenance_verified:true,wrong_irreversible_route:0,wrong_order_binding:0,repeated_clarification:0,owner_routing:1,explicit_return_recall:1,explicit_order_recall:1,date_window_accuracy:.99,current_replay_verified:true,executor_reconciliation_contract_verified:true,unknown_execution_no_blind_retry_tests:true};
const env={CONVERSATION_V3_ENABLED:'true',CONVERSATION_INTELLIGENCE_V3_MODE:'LIVE',CONVERSATION_V3_STATUS_REPLY_ENABLED:'true',CONVERSATION_V3_CLARIFICATION_ENABLED:'true'};
test('money and status require fresh exact reads, consistent native amount and owner payment terms',()=>{
 const x=fixture();assert.equal(policy(x).paymentVerified,true);
 for(const mutate of [x=>x.freshProof.exactConversationVerified=false,x=>x.freshProof.orderReadAt=new Date(now-61000).toISOString(),x=>x.order.orderAmount=24.99,x=>x.issue.raw.order_id=90002]){const x=fixture();mutate(x);assert.equal(policy(x).paymentVerified,false);}
 assert.equal(policy(fixture(),{paymentMethods:[]}).paymentVerified,false);
});
test('an accepted discount delegates before a payment question and never quotes the original amount',()=>{
 const x=fixture([msg('¿Acepta el descuento de 5 €?',1,'out'),'Sí, acepto el descuento','¿Cómo pago?']);x.policy=policy(x);
 const c=compileCustomerCase(x);assert.equal(c.discount_response,'ACCEPTED');assert.equal(c.owner,'existing_accepted_discount_workflow');assert.equal(c.proposed_response,null);
});
test('verified owner receipt plus fresh final total permits only the discounted payment amount',()=>{
 const x=fixture([msg('¿Acepta el descuento de 5 €?',1,'out'),'Sí, acepto el descuento','¿Cómo pago?']);x.order.orderAmount=x.order.raw.total_amount=24.99;
 const receipt={status:'verified',raw:{orderId:'90001',originalCents:2999,finalCents:2499,supportPlan:{conversationId:'fixture-live'}}};
 x.policy=policy(x,{supportReceipt:receipt});const c=compileCustomerCase(x);
 assert.equal(c.discount_applied_verified,true);assert.match(c.proposed_response,/24,99\s*€/);assert.doesNotMatch(c.proposed_response,/29,99|dispon|qué día|franja/);assert.match(c.proposed_response,/efectivo o con tarjeta/);
 receipt.raw.finalCents=1999;x.policy=policy(x,{supportReceipt:receipt});assert.equal(compileCustomerCase(x).proposed_response,null);
});
test('unaccepted or rejected offer uses only the actual undiscounted amount',()=>{
 const x=fixture([msg('¿Acepta el descuento de 5 €?',1,'out'),'No quiero el descuento pero sí el pedido','¿Cómo pago?']);x.policy=policy(x);
 const c=compileCustomerCase(x);assert.equal(c.discount_response,'REJECTED');assert.equal(c.wants_order,true);assert.equal(c.wants_return,false);assert.match(c.proposed_response,/29,99\s*€/);
});
test('fresh read timestamps do not invalidate an otherwise identical revalidation; amount changes do',()=>{
 const x=fixture();x.policy=policy(x);const c=compileCustomerCase(x),y=structuredClone(x);y.now+=1000;y.freshProof.orderReadAt=y.freshProof.conversationReadAt=new Date(y.now).toISOString();y.policy=policy(y);
 const same=compileCustomerCase(y,c);assert.equal(c.case_hash,same.case_hash);
 y.order.orderAmount=y.order.raw.total_amount=24.99;assert.throws(()=>readCompiledIntent(c,y),/STALE_PLAN/);
});
test('LIVE cannot send without a durable capability admission even when its switches are enabled',()=>{
 const x=fixture();x.policy=policy(x);const result=decorateConversationV3({eligible:false,reason:'NO_DELIVERY_REQUEST'},x,{env,releaseReport:report,authorizationRef:'OWNER-LIVE'});
 assert.equal(result.plan.eligible,false);assert.ok(result.capabilityCandidate);assert.match(result.capabilityCandidate.content,/incidencia de entrega/);
 const c=result.care,admission={persistent:true,authorization_ref:'OWNER-LIVE',capability:'STATUS_REPLY',stage:'CANARY',case_key:'90001:80001',conversation_id:'fixture-live',input_hash:c.input_hash};
 const admitted=decorateConversationV3({eligible:false},x,{env,releaseReport:report,authorizationRef:'OWNER-LIVE',admission});assert.equal(admitted.plan.eligible,true);assert.equal(admitted.plan.care_capability,'STATUS_REPLY');
 admission.conversation_id='other';assert.equal(decorateConversationV3({eligible:false},x,{env,releaseReport:report,authorizationRef:'OWNER-LIVE',admission}).plan.eligible,false);
});
test('a subsequent explicit refusal never causes delivery/payment questions',()=>{
 const x=fixture(['Sí quiero el pedido','el lunes','por la tarde','No quiero el pedido']);x.policy=policy(x);const c=compileCustomerCase(x);
 assert.equal(c.operational_action,'REQUEST_RETURN');assert.equal(c.proposed_response,null);assert.equal(c.owner,'existing_return_workflow');
});

test('fresh refusal, accepted discount or ambiguous intent blocks an older delivery solution while SHADOW and valid legacy delivery remain unchanged',()=>{
 const legacy=Object.freeze({eligible:true,kind:'SOLUTION',reason:'CUSTOMER_DELIVERY_PREFERENCE',hash:'synthetic-existing-plan'});
 for(const texts of [['Sí quiero el pedido','el lunes','por la tarde','No quiero el pedido'],[msg('¿Acepta el descuento de 5 €?',1,'out'),'Sí, acepto el descuento'],['Quizás quiera recibirlo, no sé']]){
  const x=fixture(texts);x.policy=policy(x);
  const live=decorateConversationV3(legacy,x,{env,releaseReport:report,authorizationRef:'OWNER-LIVE'});
  assert.equal(live.plan.eligible,false);assert.match(live.plan.reason,/V3_(OPERATIONAL|UNCERTAIN_OPERATIONAL)_CONTEXT/);
  const shadow=decorateConversationV3(legacy,x,{env:{...env,CONVERSATION_INTELLIGENCE_V3_MODE:'SHADOW'},releaseReport:report});assert.equal(shadow.plan,legacy);
 }
 const x=fixture(['Sí quiero el pedido','el lunes','por la tarde']);x.policy=policy(x);
 assert.equal(decorateConversationV3(legacy,x,{env,releaseReport:report,authorizationRef:'OWNER-LIVE'}).plan,legacy);
});
