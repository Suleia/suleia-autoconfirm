import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCustomerCase,interpretMessage,OWNERS} from './context.mjs';
import {routeCustomerCase,requiredMissingSlots,responseForPlan,assertFreshPlan} from './policy.mjs';
import {interpretCustomerCase,observeCustomerCare,compareCareReplay} from './runtime.mjs';
import {decorateClarification,revalidateCarePlan} from './clarification-adapter.mjs';
import {createCustomerCareStore} from './store.mjs';

const baseAt=Date.parse('2026-10-30T10:00:00Z'),now=baseAt+3*3600000;
let n=0;
const inbound=(content,minutes=0,extra={})=>({id:String(++n),mid:'incoming-'+n,user_ns:'fixture-conversation',type:'in',content,ts:(baseAt+minutes*60000)/1000,...extra});
const outbound=(content,minutes=-1,extra={})=>({id:String(++n),mid:'wamid.fixture-'+n,user_ns:'fixture-conversation',type:'agent',content,ts:(baseAt+minutes*60000)/1000,...extra});
const context=(messages=[],overrides={})=>({order:{orderId:'90001',status:'ERROR',createdAt:'2026-10-29T09:00:00Z',currencyCode:'EUR'},incident:{orderId:'90001',incidenceId:'80001',incidentType:'rejected_goods',incidenceDate:'2026-10-30T09:00:00Z',chatbyUserNs:'fixture-conversation',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},messages,binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'fixture-conversation'},policy:{requireDeliveryDate:true,requireDeliveryWindow:true},now,...overrides});
const care=(messages,overrides={},previous=null)=>interpretCustomerCase(context(messages,overrides),previous);
const env={CUSTOMER_CARE_ENABLED:'true',CUSTOMER_CARE_CONTEXT_ENABLED:'true',CUSTOMER_CARE_CLARIFICATION_ENABLED:'true',CUSTOMER_CARE_MODE:'CANARY'};

test('explicit refusal composes return + discount rejection and delegates without asking',()=>{
 const state=care([outbound('Oferta',-1,{payload:{name:'es_es_dropea_incidencia_descuento_5_v1'}}),inbound('No quiero el pedido')]);
 assert.equal(state.wants_return,true);assert.equal(state.wants_order,false);assert.ok(state.latest_customer_intents.includes('REJECTS_DISCOUNT'));assert.equal(state.capability,'RETURN');assert.equal(state.next_best_action,'DELEGATE');assert.equal(responseForPlan(state,state),null);
});
test('no attempt is positive delivery intent, never carrier-label rejection',()=>{
 const state=care([inbound('Sigo esperando, nadie ha venido')]);
 assert.equal(state.wants_order,true);assert.equal(state.reports_no_delivery_attempt,true);assert.equal(state.wants_return,false);assert.ok(state.latest_customer_intents.includes('REQUESTS_REDELIVERY'));
});
test('tomorrow afternoon has both slots and delegates to the gateway',()=>{
 const state=care([inbound('Mañana por la tarde')]);assert.equal(state.delivery_date,'2026-10-31');assert.equal(state.delivery_window,'AFTERNOON');assert.equal(state.next_best_action,'DELEGATE');assert.deepEqual(state.missing_slots,[]);
});
test('consecutive facts accumulate, contact preserved, courtesy cannot erase them',()=>{
 const messages=[inbound('Sí quiero el pedido'),inbound('El viernes',1),inbound('Por la tarde',2),inbound('Que me llamen antes',3),inbound('Hola',4)];
 const state=care(messages);assert.equal(state.delivery_date,'2026-10-30');assert.equal(state.delivery_window,'AFTERNOON');assert.equal(state.call_before_arrival,true);assert.equal(state.wants_order,true);assert.equal(state.next_best_action,'DELEGATE');assert.equal(state.conversation_version,5);
 const again=care(messages,{},state);assert.equal(again.conversation_version,5);
});
test('short window answer uses the actual preceding question',()=>{
 const state=care([inbound('El sábado'),outbound('¿Prefiere mañana o tarde?',1),inbound('Tarde',2)]);
 assert.equal(state.delivery_date,'2026-10-31');assert.equal(state.delivery_window,'AFTERNOON');assert.equal(state.next_best_action,'DELEGATE');
 const morning=care([inbound('El sábado'),outbound('¿Prefiere mañana o tarde?',1),inbound('Mañana',2)]);assert.equal(morning.delivery_date,'2026-10-31');assert.equal(morning.delivery_window,'MORNING');
});
test('latest explicit negative supersedes desire, latest positive cannot undo a verified return',()=>{
 const messages=[inbound('Sí quiero el pedido'),inbound('Mejor no, no lo quiero',10)];const a=care(messages);assert.equal(a.wants_return,true);assert.equal(a.capability,'RETURN');assert.equal(a.change_of_mind_detected,1);
 const b=care([...messages,inbound('Quiero recibirlo',20)],{policy:{irreversibleAction:'RETURN_REQUESTED'}});assert.equal(b.next_best_action,'HUMAN_REVIEW');assert.equal(b.reason,'IRREVERSIBLE_ACTION_ALREADY_EXECUTED');
});
test('only the missing window is asked; known date and intent never re-asked',()=>{
 const a=care([inbound('Quiero el pedido el sábado')]);assert.deepEqual(a.missing_slots,['TIME_WINDOW']);assert.equal(responseForPlan(a,a),'Perfecto. ¿Prefiere recibirlo por la mañana o por la tarde?');
});
test('repeated scheduler cycles without inbound produce only WAITING_CUSTOMER',()=>{
 const question=outbound('¿Qué día y en qué franja puede recibirlo?',1);const messages=[inbound('Quiero el pedido'),question];
 for(const hours of [1,1.5,2,3,24,48]){const a=care(messages,{now:baseAt+hours*3600000});assert.equal(a.next_best_action,'WAITING_CUSTOMER');assert.equal(a.reason,'ONE_ACTIVE_CLARIFICATION');assert.equal(responseForPlan(a,a),null);}
});
test('legacy questions with changed reason are recognized as one unresolved question',()=>{
 const a=care([inbound('Quiero el pedido'),outbound('Confirme que dispondrá de 24,99 € en efectivo. Indíquenos también el día y la franja en que puede recibirlo.',1),outbound('¿Qué día y en qué franja puede recibirlo?',2)]);
 assert.equal(a.next_best_action,'WAITING_CUSTOMER');assert.equal(a.findings[0].code,'REPEATED_CLARIFICATION');
});
test('payment is information and never a required slot; verified cash/card wording',()=>{
 const policy={requireDeliveryDate:true,requireDeliveryWindow:true,paymentVerified:true,paymentMethod:'COD',amountDue:24.99,allowedPaymentMethods:['CASH','CARD']};
 const a=care([inbound('Quiero recibirlo el sábado por la tarde')],{policy});assert.deepEqual(requiredMissingSlots(a,policy),[]);assert.equal(a.next_best_action,'DELEGATE');
 const b=care([inbound('¿Cómo puedo pagar?')],{policy});const text=responseForPlan(b,b,policy);assert.match(text,/24,99/);assert.match(text,/en efectivo o con tarjeta/);assert.doesNotMatch(text,/[?¿]|dispone|confirme/);
 const c=care([inbound('¿Cómo puedo pagar?')]);assert.equal(c.next_best_action,'HUMAN_REVIEW');assert.equal(responseForPlan(c,c),null);
});
test('unknown card availability is never advertised; amount change requires revalidation',()=>{
 const policy={paymentVerified:true,amountDue:29.99,allowedPaymentMethods:['CASH'],paymentMethod:'COD'};
 const a=care([inbound('¿Cómo puedo pagar?')],{policy});assert.doesNotMatch(responseForPlan(a,a,policy),/tarjeta/);
 const b=care([inbound('¿Cómo puedo pagar?')],{policy:{...policy,amountDue:24.99}});assert.throws(()=>assertFreshPlan(a,b),/STALE_PLAN/);
});
test('yes has no global meaning; verified offer context is required',()=>{
 assert.equal(care([inbound('Sí')]).next_best_action,'HUMAN_REVIEW');
 const offer=outbound('Oferta',-1,{payload:{name:'es_es_dropea_incidencia_descuento_5_v1'}});
 const a=care([offer,inbound('Sí')]);assert.equal(a.discount_response,'ACCEPTED');assert.equal(a.capability,'DISCOUNT_ACCEPT');
});
test('confirmation is delegated to its existing owner',()=>{
 const source=context([outbound('Confirme',-1,{payload:{name:'dropea_pedido_reminder_v1'}}),inbound('Sí')]);source.order.status='PENDING_CONFIRMATION';const a=interpretCustomerCase(source);assert.equal(a.capability,'CONFIRM_ORDER');assert.equal(a.owner,OWNERS.CONFIRM_ORDER);
});
test('exact order/conversation/active issue binding is mandatory',()=>{
 for(const binding of [{verified:false},{verified:true,orderId:'90002',issueId:'80001',conversationId:'fixture-conversation'},{verified:true,orderId:'90001',issueId:'wrong',conversationId:'fixture-conversation'}])assert.equal(care([inbound('Quiero el pedido')],{binding}).next_best_action,'HUMAN_REVIEW');
 assert.equal(care([inbound('Quiero el pedido',0,{user_ns:'another-order'})]).reason,'CONVERSATION_IDENTITY_CONFLICT');
 const old=inbound('Quiero el pedido',-3000);assert.equal(care([old]).has_current_reply,false);
});
test('late cancellation makes prepared plan stale, including new greetings',()=>{
 const m=inbound('Mañana por la tarde'),a=care([m]),b=care([m,inbound('No lo quiero',10)],{},a);
 assert.throws(()=>assertFreshPlan(a,b),/STALE_PLAN/);assert.equal(b.capability,'RETURN');assert.ok(b.conversation_version>a.conversation_version);
 const c=care([m,inbound('Hola',11)],{},a);assert.throws(()=>assertFreshPlan(a,c),/STALE_PLAN/);
});
test('edited event changes version and erases superseded facts on full replay',()=>{
 const m=inbound('Mañana por la tarde');const a=care([m]);const b=care([{...m,content:'No quiero el pedido'}],{},a);assert.ok(b.conversation_version>a.conversation_version);assert.equal(b.wants_order,false);assert.equal(b.delivery_date,null);
});
test('precise ranges and exact hours are preserved without guessing AM/PM',()=>{
 const a=care([inbound('El sábado entre las 17:00 y las 20:00')]);assert.equal(a.time_from,'17:00');assert.equal(a.time_to,'20:00');assert.deepEqual(a.missing_slots,[]);
 const b=care([inbound('El sábado a las 5')]);assert.equal(b.next_best_action,'HUMAN_REVIEW');assert.equal(b.reason,'AMBIGUOUS_CLOCK');
});
test('addresses and pickup always delegate; only the missing postcode is identified',()=>{
 const a=care([inbound('Nueva dirección: calle Ejemplo 7, Ciudad')]);assert.equal(a.capability,'ADDRESS');assert.ok(a.missing_slots.includes('POSTAL_CODE'));
 const b=care([inbound('Quiero recoger en agencia')]);assert.equal(b.capability,'AGENCY');
});
test('status requires fresh source reads, FAQ requires verified sources, damage escalates',()=>{
 const a=care([inbound('¿Dónde está mi pedido?')]);assert.equal(a.next_best_action,'WAITING_PROVIDER');
 const b=care([inbound('¿Dónde está mi pedido?')],{policy:{providerReadVerified:true,providerReadAt:new Date(now).toISOString()}});assert.equal(b.response_type,'ORDER_STATUS');
 assert.equal(care([inbound('¿Cómo usar el producto?')]).reason,'VERIFIED_PRODUCT_SOURCE_REQUIRED');
 assert.equal(care([inbound('El producto está roto')]).reason,'PRODUCT_INCIDENT_REQUIRES_SPECIALIST');
});
test('expired dates are cleared, greeting preserves a still valid schedule',()=>{
 const m=inbound('Mañana por la tarde');const a=care([m],{now:baseAt+3*86400000});assert.equal(a.delivery_date,null);assert.equal(a.expired_delivery_date,'2026-10-31');
});
test('flags disabled or SHADOW keep every legacy plan unchanged and cannot write',()=>{
 const legacy={eligible:true,kind:'CLARIFY',content:'Legacy',hash:'old'};
 for(const e of [{},{...env,CUSTOMER_CARE_MODE:'SHADOW'}])assert.equal(decorateClarification(legacy,context([inbound('Quiero el pedido')]),{env:e,canaryCase:'90001:80001'}).plan,legacy);
 const solution={eligible:true,kind:'SOLUTION',note:'existing action'};assert.equal(decorateClarification(solution,context([inbound('Mañana por la tarde')]),{env,canaryCase:'90001:80001'}).plan,solution);
});
test('canary decorates one allowed clarification with only its missing slot',()=>{
 const input=context([inbound('Quiero el pedido el sábado')]);const legacy={eligible:true,kind:'CLARIFY',content:'Legacy'};
 const {plan,care:a}=decorateClarification(legacy,input,{env,canaryCase:'90001:80001'});assert.equal(plan.content,'Perfecto. ¿Prefiere recibirlo por la mañana o por la tarde?');revalidateCarePlan(plan,a);
 const same=decorateClarification(legacy,input,{env,canaryCase:'90002:80002'});assert.equal(same.plan,legacy);
 const waiting=decorateClarification(legacy,context([...input.messages,outbound(plan.content,1)]),{env,canaryCase:'90001:80001'});assert.equal(waiting.plan.eligible,false);assert.equal(waiting.care.next_best_action,'WAITING_CUSTOMER');
});
test('observer adds private state but cannot invoke a sender or alter protected data',async()=>{
 const item=context([inbound('Mañana por la tarde')]);const original=structuredClone(item);let saves=0;
 const store={load:async()=>null,save:async s=>{saves++;return s;}};
 const report=await observeCustomerCare([item],{env:{...env,CUSTOMER_CARE_MODE:'SHADOW'},store,now});assert.equal(report.provider_writes,0);assert.equal(saves,1);assert.deepEqual(item.order,original.order);assert.deepEqual(item.messages,original.messages);assert.equal(item.incident.customerCare.next_best_action,'DELEGATE');
 const off=await observeCustomerCare([item],{env:{},store:{load(){throw Error('must not load');}}});assert.equal(off.enabled,false);
});
test('storage appends and CAS protects independent observers from lost updates',async()=>{
 const s=care([inbound('Mañana por la tarde')]);const calls=[];
 const store=createCustomerCareStore({enabled:()=>true,insert:async(t,row,o)=>{calls.push({t,row,o});return [row];},update:async(t,row,o)=>{calls.push({t,row,o});return [];}});
 await store.save(s);assert.match(calls[0].row.key,/customer_care_event/);assert.match(calls[1].row.key,/customer_care_case/);
 await assert.rejects(store.save(s,{updated_at:'2026-10-30T12:00:00Z'}),/CONCURRENT_UPDATE/);assert.equal(calls.at(-1).o.query.updated_at,'eq.2026-10-30T12:00:00Z');
});
test('shadow comparison counts avoided clarification without claiming resolution',()=>{
 const c=care([inbound('Mañana por la tarde')]);const r=compareCareReplay([{care:c,baseline:{kind:'CLARIFY',reason:'PRECISE_PREFERENCE_NEEDS_CLARIFICATION'}}]);assert.equal(r.fewer_clarification_opportunities,1);assert.equal(r.cases_reviewed,1);
});

test('payment unavailability is a real constraint, not an invented cash-confirmation requirement',()=>{
 const a=care([inbound('Quiero el pedido'),inbound('No tengo efectivo hasta el mes próximo',10)]);
 assert.equal(a.reason,'CUSTOMER_PAYMENT_CONSTRAINT_REQUIRES_REVIEW');assert.equal(a.next_best_action,'HUMAN_REVIEW');
});
test('a negated weekday and disputed order origin never become a return or retry',()=>{
 const a=care([inbound('No quiero el viernes')]);assert.equal(a.wants_return,false);assert.equal(a.next_best_action,'HUMAN_REVIEW');
 const b=care([inbound('Yo no he pedido esto')]);assert.equal(b.reason,'ORDER_ORIGIN_DISPUTED');
});
