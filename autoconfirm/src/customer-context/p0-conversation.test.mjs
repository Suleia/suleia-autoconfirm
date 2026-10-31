import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCustomerCase} from './case-compiler.mjs';
const start=Date.parse('2026-10-30T12:00:00Z');
const message=(text,index,type='in')=>({id:String(index),type,user_ns:'p0-fixture',content:text,ts:(start+index*60000)/1000,...(type==='agent'?{mid:'wamid.synthetic-'+index}:{})});
function input(texts,extra={}){return {order:{orderId:'90001',status:'ERROR',createdAt:'2026-10-28T08:00Z',raw:{line_items:[{product_id:33560,variant_id:33788,quantity:1}]}},incident:{orderId:'90001',incidenceId:'80001',incidentType:'absent',incidenceDate:'2026-10-30T08:00Z',chatbyUserNs:'p0-fixture',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},issue:{raw:{id:80001,order_id:90001,is_active:true,status:'PENDING',allowed_resolution_options:['PROVIDE_SOLUTION']}},binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'p0-fixture'},messages:texts.map((s,i)=>typeof s==='string'?message(s,i):s),now:Date.parse('2026-10-31T16:00Z'),policy:{requireDeliveryDate:true,requireDeliveryWindow:true},...extra};}
test('a logistics answer cannot erase an unanswered product or payment question',()=>{
 const c=compileCustomerCase(input(['¿Cómo se usa el producto y cuánto tengo que pagar?','Quiero recibirlo el lunes hacia el mediodía, que me llamen antes']));
 assert.ok(c.pending_customer_questions.some(q=>q.type==='ASKS_USAGE'));
 assert.ok(c.pending_customer_questions.some(q=>q.type==='ASKS_PAYMENT'));
 assert.equal(c.delivery_date,'2026-11-02');assert.equal(c.call_before_arrival,true);
 assert.notEqual(c.customer_reply_action,'CLARIFY');
});
test('an unrelated acknowledgement does not answer delivery slots or release a second clarification',()=>{
 const c=compileCustomerCase(input([message('¿Qué día y franja le vienen bien?',0,'agent'),'Gracias, luego lo miro']));
 const question=c.clarifications[0];assert.equal(question.answered_at,null);
 assert.ok(question.remaining_slots.includes('DELIVERY_DATE'));assert.equal(c.proposed_response,null);
});
test('multiple intentions retain amount as customer evidence, never provider money',()=>{
 const c=compileCustomerCase(input(['Quiero solo un pedido por 24,99, ninguno más. Me escriben varios y me estáis liando. ¿Cómo uso la crema?','El lunes hacia el mediodía y que me llamen antes']));
 assert.equal(c.current_facts.REQUESTS_SINGLE_ORDER.value_json,true);
 assert.equal(c.current_facts.DUPLICATE_ORDER_CONCERN.value_json,true);
 assert.equal(c.current_facts.CUSTOMER_MENTIONED_AMOUNT.value_json,'24.99');assert.equal(c.amount_due,null);
 assert.ok(c.pending_customer_questions.some(q=>q.type==='ASKS_USAGE'));
});
test('a conditional return of another parcel never authorizes return of the intended parcel',()=>{
 const c=compileCustomerCase(input(['Quiero mi pedido. Si me enviáis otro, lo devolveré.']));
 assert.equal(c.wants_return,false);assert.equal(c.cancel_intent,false);assert.notEqual(c.operational_action,'REQUEST_RETURN');
 assert.equal(c.current_facts.CONDITIONAL_RETURN_THREAT.value_json,true);
});
test('frustration preserves Monday noon and never creates an irreversible action',()=>{
 const c=compileCustomerCase(input([message('¿Qué día y horario le vienen bien?',0,'agent'),'El lunes hacia el mediodía, que me llamen antes',message('El horario indicado ya pasó. ¿Qué otro día?',2,'agent'),'Es igual']));
 assert.equal(c.delivery_date,'2026-11-02');assert.equal(c.wants_return,false);assert.equal(c.cancel_intent,false);assert.equal(c.proposed_response,null);
});
test('the question ledger requires the addressed facts and a verified provider readback to mark product support answered',()=>{
 const original=input(['¿Cómo uso el producto?','El lunes por la tarde']);const first=compileCustomerCase(original);
 const question=first.pending_customer_questions.find(q=>q.type==='ASKS_USAGE');assert.ok(question);
 const prior={...first,timeline:[...first.timeline,{kind:'INFORMATION_RESPONSE',status:'PROVIDER_ACCEPTED',provider_message_id:'wamid.synthetic-answer',readback_verified:true,answered_fact_ids:[question.fact_id],at:'2026-10-31T15:00Z'}]};
 const second=compileCustomerCase(original,prior);assert.ok(!second.pending_customer_questions.some(q=>q.fact_id===question.fact_id));
});
