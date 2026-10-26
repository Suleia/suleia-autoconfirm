import test from 'node:test';import assert from 'node:assert/strict';
import {deliveryReplyPlan,NON_DELIVERY_ACK}from'./delivery-reply-policy.mjs';
import {deliveryContactContext,deliveryScheduleText,requestedDayOfMonth,pickupContext}from'./delivery-conversation-context.mjs';
const now=Date.parse('2026-10-26T15:00:00Z');
function fixture(text){return {incident:{orderId:'900001',incidenceId:'800001',incidentType:'absent',chatbyUserNs:'fixture',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',incidenceDate:'2026-10-26T08:00:00Z'},
 order:{orderId:'900001',status:'ERROR',createdAt:'2026-10-24T08:00:00Z',customerName:'Fixture',customerPhone:'600000001',orderAmount:24.99,currencyCode:'EUR',raw:{shipping_address:{country:'ES',postal_code:'28001'}}},
 issue:{id:800001,order_id:900001,type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,allowed_resolution_options:['PROVIDE_SOLUTION','RETRY']},
 messages:[{id:'700001',type:'in',user_ns:'fixture',ts:Date.parse('2026-10-26T12:00:00Z')/1000,payload:{text}}],now};}
function add(i,text,at='2026-10-26T12:01:00Z'){i.messages.push({id:String(700001+i.messages.length),type:'in',user_ns:'fixture',ts:Date.parse(at)/1000,payload:{text}});return i;}
test('morning availability plus a separate call requirement becomes one delivery instruction',()=>{
 for(const text of ['Puedes veni por la mañana pero llamas antes de llegar','Pueden venir por la mañana y me avisan antes de llegar',
  'Podrían pasar en horario de mañana, pero llame antes de llegar','Por la mañana y avísame antes de venir']){
  const p=deliveryReplyPlan(fixture(text));assert.equal(p.kind,'SOLUTION',text);assert.equal(p.date,'2026-10-27',text);assert.equal(p.time_window,'morning',text);
  assert.equal(p.callBeforeArrival,true);assert.match(p.note,/llamen antes de llegar/);assert.equal(p.scheduleSource,'OWNER_NEXT_BUSINESS_CUSTOMER_WINDOW');
  assert.match(p.note,/Proponemos próxima fecha hábil/);assert.ok(p.evidence.some(m=>m.text===text));
 }
});
test('explicit date/window and later contact details are combined without erasing the date',()=>{
 const i=add(fixture('Mañana por la tarde'),'Me llaman antes de llegar');const p=deliveryReplyPlan(i);
 assert.equal(p.kind,'SOLUTION');assert.equal(p.date,'2026-10-27');assert.equal(p.time_window,'afternoon');assert.equal(p.callBeforeArrival,true);assert.equal(p.evidence.length,2);
});
test('conditional, negated or alternate-phone contact cannot become unconditional delivery',()=>{
 for(const t of ['Lo quiero solo si me llaman antes de llegar','Si me llaman antes de llegar, puedo recibirlo por la mañana',
 'Por la mañana pero no me llame antes de llegar','Por la mañana pero llame al 611111111 antes de llegar']){
  const p=deliveryReplyPlan(fixture(t));assert.notEqual(p.kind,'SOLUTION',t);
 }
 assert.equal(deliveryContactContext('No me llamen antes de llegar').noCall,true);
 assert.match(deliveryScheduleText('Lo quiero solo si me llaman antes de llegar'),/solo si/);
 assert.equal(deliveryContactContext('2026-10-27 por la mañana y me llamas antes de llegar').differentPhone,false);
 assert.equal(deliveryContactContext('27/10/2026 por la mañana y me avisan antes de llegar').differentPhone,false);
});
test('payment-date clarification preserves the requested date and asks for the actual missing confirmation',()=>{
 for(const t of ['Día 30, cobro mi salario. Puede ser día 30, me avisa','Cobro la nómina el día 30 y quiero recibirlo ese día']){
  const p=deliveryReplyPlan(fixture(t));assert.equal(p.kind,'CLARIFY');assert.equal(p.reason,'PAYMENT_OR_PRICE_NEEDS_CONFIRMATION');
  assert.equal(p.context.requestedDate,'2026-10-30');assert.match(p.content,/30\/10\/2026/);assert.match(p.content,/24,99 €/);assert.match(p.content,/dispondrá/);assert.doesNotMatch(p.content,/sigue queriendo/);
 }
 const p=deliveryReplyPlan(fixture('No tenía efectivo. Mañana por la tarde'));
 assert.equal(p.kind,'CLARIFY');assert.match(p.content,/27\/10\/2026 por la tarde/);assert.doesNotMatch(p.content,/qué día|que dia|qué franja|que franja/);
});
test('cash is not invented from payday or a vague yes, but explicit current funds can qualify',()=>{
 for(const text of ['Cobro el día 30','Si tengo dinero mañana por la tarde','No tengo efectivo mañana por la tarde'])assert.notEqual(deliveryReplyPlan(fixture(text)).kind,'SOLUTION');
 const p=deliveryReplyPlan(fixture('Ya tengo el efectivo, mañana por la tarde'));assert.equal(p.kind,'SOLUTION');assert.equal(p.time_window,'afternoon');
});
test('day-only dates never roll into an invented month or accept an invalid day',()=>{
 assert.equal(requestedDayOfMonth('día 30',now),'2026-10-30');
 for(const t of ['día 20','día 0','día 32','día 30 o día 31'])assert.equal(requestedDayOfMonth(t,now),null,t);
 assert.equal(requestedDayOfMonth('día 31',Date.parse('2026-11-25T10:00:00Z')),null);
});
test('conditional office pickup is routed for agency verification rather than a home-delivery question',()=>{
 const p=deliveryReplyPlan(fixture('Si está en la oficina voy por el miércoles'));assert.equal(p.eligible,false);assert.equal(p.reason,'PICKUP_REQUIRES_VERIFIED_AGENCY');
 assert.equal(p.context.customerIntent,'REQUESTS_AGENCY');assert.deepEqual(p.context.missing,['VERIFIED_AGENCY_AVAILABILITY']);assert.equal(p.note,undefined);assert.equal(p.content,undefined);
 assert.equal(pickupContext('Estoy trabajando en una oficina por la mañana'),false);
});
test('courtesy does not erase a preference, while a late courtesy still resets the settling guard',()=>{
 for(const text of ['Gracias a vosotros','Muchas gracias','Vale gracias','👍']){
  const p=deliveryReplyPlan(add(fixture('Mañana por la tarde'),text));assert.equal(p.kind,'SOLUTION',text);assert.equal(p.date,'2026-10-27');
 }
 assert.equal(deliveryReplyPlan(add(fixture('Mañana por la tarde'),'Gracias','2026-10-26T14:45:00Z')).reason,'REPLY_SETTLING_WINDOW');
});
test('new courtesy cannot resurrect a cancellation or an expired date',()=>{
 const cancelled=add(fixture('No quiero el pedido'),'Gracias');assert.equal(deliveryReplyPlan(cancelled).eligible,false);
 const old=fixture('Mañana por la tarde');old.messages[0].ts=Date.parse('2026-10-24T10:00:00Z')/1000;old.incident.incidenceDate='2026-10-24T08:00:00Z';
 add(old,'Hola','2026-10-26T12:00:00Z');assert.notEqual(deliveryReplyPlan(old).kind,'SOLUTION');
});
test('the owner acknowledgement remains exact and a later cancellation or address change prevents action',()=>{
 const p=deliveryReplyPlan(fixture('No han intentado entregar y sigo esperando'));assert.equal(p.acknowledgement,NON_DELIVERY_ACK);
 for(const text of ['Ya no lo quiero','Mi dirección es otra','Recoger en agencia'])assert.notEqual(deliveryReplyPlan(add(fixture('Mañana por la tarde'),text)).kind,'SOLUTION');
});
