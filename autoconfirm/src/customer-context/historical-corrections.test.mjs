import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCustomerCase,readCompiledIntent} from './case-compiler.mjs';
const at=Date.parse('2026-10-27T10:00:00Z');
const msg=(text,i,type='in')=>({id:String(i),type,user_ns:'regression',content:text,ts:(at+i*60000)/1000,...(type==='agent'?{mid:'wamid.regression-'+i}:{})});
function compile(texts,{now=at+3600000,...extra}={}){
 return compileCustomerCase({order:{orderId:'90001',createdAt:'2026-10-26T08:00:00Z',status:'INCIDENCE'},
 incident:{orderId:'90001',incidenceId:'80001',incidentType:'absent',incidenceDate:'2026-10-27T08:00:00Z',chatbyUserNs:'regression',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},
 issue:{raw:{id:80001,order_id:90001,status:'PENDING',is_active:true,allowed_resolution_options:['RETRY_DELIVERY','REQUEST_RETURN']}},
 binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'regression'},policy:{requireDeliveryDate:true,requireDeliveryWindow:true},
 messages:texts.map((t,i)=>typeof t==='string'?msg(t,i):t),now,...extra});
}
test('future availability survives a denied past attempt and a misspelled availability verb',()=>{
 const c=compile(['Nadie ha venido. Mañana hasta las.11 de la mañana eztare en casa']);
 assert.equal(c.delivery_date,'2026-10-28');assert.equal(c.time_to,'11:00');assert.equal(c.reports_no_delivery_attempt,true);
});
test('noches is not negation of a later morning availability clause',()=>{
 const c=compile(['Buenas noches, mañana por la mañana estoy en casa pueden venir']);
 assert.equal(c.delivery_window,'MORNING');assert.equal(c.delivery_date,'2026-10-28');
});
test('a new chosen day supersedes the earlier delivery-date question',()=>{
 const c=compile(['¿Qué día llegará mi pedido?','Quiero recibirlo el viernes por la tarde']);
 assert.equal(c.current_facts.ASKS_DELIVERY_DATE,undefined);
 assert.ok(c.fact_ledger.some(f=>f.fact_type==='ASKS_DELIVERY_DATE'&&f.status==='SUPERSEDED'));
});
test('ambiguous mañana does not invent a window, and expired exact clocks remain historical',()=>{
 const c=compile(['Quiero recibirlo el jueves a las 9:30 am','El viernes mañana'],{now:Date.parse('2026-11-02T10:00:00Z')});
 assert.equal(c.time_from,null);assert.equal(c.delivery_window,null);
 assert.ok(c.fact_ledger.some(f=>f.fact_type==='TIME_FROM'&&f.status==='EXPIRED'));
});
test('recurring afternoons are not replaced by the morning work reason or a past date',()=>{
 const c=compile(['Mañana por mañana/tarde','Que me manden el pedido de tardes por trabajo en la mañana'],{now:Date.parse('2026-10-30T10:00:00Z')});
 assert.equal(c.delivery_window,'AFTERNOON');assert.equal(c.delivery_date,null);
});
test('customer-reported receipt supersedes preferences without asserting provider delivery',()=>{
 const c=compile(['Hoy por la tarde','Ya he recibido el pedido']);
 assert.equal(c.current_facts.REPORTS_RECEIVED.value_json,true);assert.equal(c.delivery_window,null);
 assert.ok(c.fact_ledger.some(f=>f.fact_type==='DELIVERY_DATE'&&f.status==='SUPERSEDED'));
 assert.equal(c.current_facts.DELIVERED,undefined);
});
test('recurrence expiry is not a delivery date and bounded literal intervals retain their sources',()=>{
 const c=compile(['Quiero el pedido de 10 a 14','Por la tarde desde las 17 hasta que me acueste','Todos los días hasta el 30 de octubre']);
 const f=c.current_facts.DELIVERY_AVAILABILITY;
 assert.ok(f);assert.equal(f.recurring,true);assert.equal(f.supporting_event_hashes.length,2);
 assert.equal(c.delivery_date,null);assert.equal(f.valid_until,'2026-10-30T23:00:00.000Z');
 assert.ok(c.literal_delivery_preference.literal.includes('10 a 14'));
});
test('a passed upper bound cannot be counted as currently available',()=>{
 const c=compile(['Hoy hasta las 18'],{now:Date.parse('2026-10-27T18:40:00Z')});
 assert.equal(c.time_to,null);assert.ok(c.fact_ledger.some(f=>f.fact_type==='TIME_TO'&&f.status==='EXPIRED'));
});
test('an address supplied to a same-address question cannot authorize an address mutation',()=>{
 const c=compile([msg('¿La dirección sigue siendo la misma?',0,'agent'),msg('C/ Ejemplo 12',1)]);
 assert.notEqual(c.current_facts.ADDRESS_CHANGE_REQUESTED?.value_json,true);assert.equal(c.operational_action,'NONE');
});
test('a request that the nearby courier drop off the order is an existing retry fact',()=>{
 const c=compile(['Por favor, si está por aquí que pase a dejar mi pedido']);
 assert.equal(c.wants_order,true);assert.equal(c.current_facts.REQUESTS_REDELIVERY.value_json,true);
});
test('pickup consent can include a follow-up logistics question',()=>{
 const c=compile([msg('Está en el almacén de destino. ¿Quiere que avisemos que pasará a recogerlo?',0,'agent'),msg('Ok, que me llamen qué día puedo pasar',1)]);
 assert.equal(c.agency_requested,true);assert.equal(c.wants_order,true);
});
test('qualified tomorrow in a time-window answer remains a date and all-day availability',()=>{
 const c=compile([msg('¿En qué horario podrá recibirlo?',0,'agent'),msg('Sí, para mañana estaré disponible todo el día',1)]);
 assert.equal(c.delivery_date,'2026-10-28');assert.equal(c.delivery_window,null);assert.ok(c.current_facts.DELIVERY_AVAILABILITY);
});
test('bare mañana answering two slots remains unresolved after an unrelated money statement',()=>{
 const c=compile([msg('Indique el día y la franja de entrega',0,'agent'),msg('Hola mañana',1),msg('O en la tarde',2),msg('Tengo el dinero',3)]);
 assert.equal(c.delivery_date,null);assert.ok(c.missing_information.includes('DELIVERY_DATE'));assert.equal(c.operational_action,'NONE');
});
test('later product dispute cannot turn an earlier refusal into a current irreversible route',()=>{
 const c=compile(['No quiero el pedido','¿Qué producto es? Quiero ver la foto del producto']);
 assert.equal(c.next_best_action,'HUMAN_REVIEW');assert.equal(c.operational_action,'NONE');
 assert.ok(c.fact_ledger.some(f=>f.fact_type==='WANTS_RETURN'));assert.ok(c.unresolved.includes('PRODUCT_UNSUITABLE_REQUIRES_REVIEW'));
});
test('an unanswered clarification cannot expose an actionable compiled retry intent',()=>{
 const c=compile(['Quiero recibirlo el viernes por la tarde',msg('¿Quiere que solicitemos una nueva entrega? Indique día y franja horaria',2,'agent')]);
 assert.equal(c.next_best_action,'WAITING_CUSTOMER');
 const request={order:{orderId:'90001',createdAt:'2026-10-26T08:00:00Z',status:'INCIDENCE'},incident:{orderId:'90001',incidenceId:'80001',incidentType:'absent',incidenceDate:'2026-10-27T08:00:00Z',chatbyUserNs:'regression',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},issue:{raw:{id:80001,order_id:90001,status:'PENDING',is_active:true,allowed_resolution_options:['RETRY_DELIVERY','REQUEST_RETURN']}},messages:['Quiero recibirlo el viernes por la tarde',msg('¿Quiere que solicitemos una nueva entrega? Indique día y franja horaria',2,'agent')].map((t,i)=>typeof t==='string'?msg(t,i):t)};
 assert.equal(readCompiledIntent(c,request).status,'NOT_VERIFIABLE');
});
