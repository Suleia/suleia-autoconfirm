import test from 'node:test';import assert from 'node:assert/strict';
import {customerDeliverySignals,newDeliverySolution} from './customer-delivery-intent.mjs';
import {parseCustomerIntentV2} from './incident-intent-v2.mjs';
import {rejectedIntent} from './recipient-rejected-policy.mjs';
const at=Date.parse('2026-10-22T10:00Z');
for(const text of ['sigo esperando','estoy esperando el pedido','no ha venido nadie','nadie ha venido a entregarlo','no me lo han intentado entregar','no me ha llegado','sigo sin recibirlo','quiero recibirlo','¿cuándo me lo van a entregar?','estoy esperando que llegue','no han intentado entregarlo','no se ha pasado el repartidor','no meallegado el paquete, sigo esperando mi pedido'])test(`synthetic waiting request: ${text}`,()=>{
 const s=customerDeliverySignals(text),i=parseCustomerIntentV2(text,{at});
 assert.equal(s.wants_order,true);assert.equal(s.waiting_for_order,true);assert.equal(i.customer_intent,'WANTS_ORDER');assert.equal(i.confidence,'HIGH');assert.ok(i.intents.includes('REQUESTS_REDELIVERY'));assert.ok(!i.intents.includes('WANTS_RETURN'));assert.equal(rejectedIntent(text).wants_order,true);
});
test('no-attempt is distinct from not-received and cannot be inferred from a carrier code',()=>{
 const s=customerDeliverySignals('nadie ha venido y sigo esperando el pedido');assert.equal(s.delivery_attempt_denied_by_customer,true);assert.match(newDeliverySolution(s),/nadie ha acudido/);
 for(const t of ['no me ha llegado','sigo esperando']){const s=customerDeliverySignals(t);assert.equal(s.delivery_attempt_denied_by_customer,false);assert.doesNotMatch(newDeliverySolution(s),/nadie/);}
 assert.equal(customerDeliverySignals('REFUSED_BY_RECIPIENT').wants_order,false);assert.equal(customerDeliverySignals('NO ACEPTA EXPEDICIÓN').wants_order,false);
});
test('a clear refusal stays a refusal and a conditional/contradictory answer stays blocked',()=>{
 for(const t of ['ya no lo quiero','no quiero recibirlo','no quiero mi pedido']){assert.equal(customerDeliverySignals(t).wants_order,false);assert.deepEqual(parseCustomerIntentV2(t,{at}).intents,['WANTS_RETURN']);}
 for(const t of ['sigo esperando pero solo si me rebajan el precio','no sé si quiero recibirlo','quiero recibirlo y devolverlo'])assert.ok(parseCustomerIntentV2(t,{at}).intents.includes('AMBIGUOUS'),t);
 assert.equal(customerDeliverySignals('no estoy esperando el pedido').wants_order,false);
});
