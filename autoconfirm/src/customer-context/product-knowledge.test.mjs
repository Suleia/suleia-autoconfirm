import test from'node:test';import assert from'node:assert/strict';
import{verifiedProductKnowledge}from'./product-knowledge.mjs';import{productKnowledge}from'./product-knowledge-data.mjs';
import{compileCustomerCase}from'./case-compiler.mjs';
const now=Date.parse(productKnowledge[0].verifiedAt)+60000;
const order={orderId:'90001',createdAt:'2026-10-28T08:00Z',status:'ERROR',raw:{line_items:[{product_id:31547,variant_id:31547,quantity:2}]}};
test('support source binds exact catalog identities and expires without guessing by customer-mentioned brand',()=>{
 const faq=verifiedProductKnowledge(order,{now,questions:['ASKS_USAGE']});assert.equal(faq.units,2);assert.match(faq.text,/NIDA/);assert.match(faq.text,/mañana/);
 assert.equal(verifiedProductKnowledge({...order,raw:{line_items:[{product_id:999,variant_id:31547,quantity:1}]}},{now}),null);
 assert.equal(verifiedProductKnowledge(order,{now:now+8*86400000}),null);
 assert.equal(verifiedProductKnowledge({...order,raw:{line_items:[...order.raw.line_items,{product_id:31666,variant_id:31666,quantity:1}]}},{now}),null);
});
test('one coherent reply answers product and verified money; customer mentions never overwrite discounted amount',()=>{
 const at=Date.parse('2026-10-31T18:00Z');const input={order,incident:{orderId:'90001',incidenceId:'80001',incidentType:'absent',incidenceDate:'2026-10-30T08:00Z',chatbyUserNs:'support-fixture',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},issue:{raw:{id:80001,order_id:90001,is_active:true}},binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'support-fixture'},now,policy:{paymentVerified:true,amountDue:24.99,allowedPaymentMethods:['CASH'],providerReadVerified:true},messages:[{id:'q1',user_ns:'support-fixture',type:'in',ts:at/1000,content:'¿Cómo uso la crema y cuánto tengo que pagar? Me habían dicho 29,99.'}]};
 const care=compileCustomerCase(input);assert.match(care.proposed_response,/NIDA/);assert.match(care.proposed_response,/24,99/);assert.doesNotMatch(care.proposed_response,/29,99/);assert.equal(care.response_question_fact_ids.length,2);
});
test('a pending delivery clarification does not suppress verified product support or authorize a new question',()=>{
 const at=Date.parse('2026-10-31T18:00Z'),binding={verified:true,orderId:'90001',issueId:'80001',conversationId:'support-fixture'};
 const input={order,incident:{orderId:'90001',incidenceId:'80001',incidentType:'absent',incidenceDate:'2026-10-30T08:00Z',chatbyUserNs:'support-fixture',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},issue:{raw:{id:80001,order_id:90001,is_active:true}},binding,now,policy:{providerReadVerified:true},messages:[{id:'q0',mid:'wamid.synthetic-pending',user_ns:'support-fixture',type:'agent',ts:(at-60000)/1000,content:'¿Qué día y franja le vienen bien?'},{id:'a0',user_ns:'support-fixture',type:'in',ts:at/1000,content:'¿Cómo uso la crema por la mañana o por la noche?'}]};
 const care=compileCustomerCase(input);assert.equal(care.customer_reply_action,'STATUS_RESPONSE');assert.match(care.proposed_response,/NIDA/);assert.doesNotMatch(care.proposed_response,/\?/);assert.equal(care.clarifications[0].answered_at,null);assert.equal(care.operational_action,'NONE');
});
test('a literal logistics preference retains product support until the verified reply, then delegates the same preference',()=>{
 const at=Date.parse('2026-10-31T18:00Z'),input={order,incident:{orderId:'90001',incidenceId:'80001',incidentType:'absent',incidenceDate:'2026-10-30T08:00Z',chatbyUserNs:'support-fixture',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},issue:{raw:{id:80001,order_id:90001,is_active:true,allowed_resolution_options:['PROVIDE_SOLUTION']}},binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'support-fixture'},now,policy:{providerReadVerified:true},messages:[{id:'both',user_ns:'support-fixture',type:'in',ts:at/1000,content:'Quiero el pedido el lunes hacia el mediodía. ¿Cómo uso la crema?'}]};
 const first=compileCustomerCase(input);assert.equal(first.customer_reply_action,'STATUS_RESPONSE');assert.equal(first.delivery_date,'2026-11-02');assert.match(first.proposed_response,/NIDA/);
 const prior={...first,timeline:[...first.timeline,{kind:'INFORMATION_RESPONSE',status:'PROVIDER_ACCEPTED',provider_message_id:'wamid.synthetic-resolved',readback_verified:true,answered_fact_ids:first.response_question_fact_ids}]};
 const next=compileCustomerCase(input,prior);assert.equal(next.operational_action,'RETRY_DELIVERY');assert.equal(next.delivery_date,'2026-11-02');assert.equal(next.proposed_response,null);
});
