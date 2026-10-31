import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCustomerCase,assertFreshCompilation,readCompiledIntent} from './case-compiler.mjs';
import {requiredMissingInformation} from './missing-information.mjs';
import {validateCustomerFacts} from './fact-extractor.mjs';
import {semanticFallback,compileSemanticContext} from './semantic-interpreter.mjs';
import {factOutputSchema} from './fact-schema.mjs';
import {evaluateConversationRelease} from './release-gates.mjs';
import {observeConversationV3} from './runtime.mjs';
import {decorateConversationV3} from './sender-adapter.mjs';
import {resolutionCandidate} from '../workflows/incident-resolution-plan.mjs';
import {hash} from '../customer-care/context.mjs';
const at=Date.parse('2026-10-30T10:00:00Z'),now=at+3*3600000;
const message=(text,i=0,direction='in',extra={})=>({id:String(i+1),type:direction,content:text,user_ns:'fixture-v3',ts:(at+i*60000)/1000,...extra});
function input(texts,extra={}){
 return {order:{orderId:'90001',status:'ERROR',createdAt:'2026-10-29T08:00:00Z'},
  incident:{orderId:'90001',incidenceId:'80001',incidentType:'absent',incidenceDate:'2026-10-30T08:00:00Z',chatbyUserNs:'fixture-v3',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},
  issue:{raw:{id:80001,order_id:90001,status:'PENDING',is_active:true,type:'RECIPIENT_ABSENT',allowed_resolution_options:['RETRY_DELIVERY','REQUEST_RETURN','PROVIDE_SOLUTION']}},
  messages:texts.map((s,i)=>typeof s==='string'?message(s,i):s),now,policy:{requireDeliveryDate:true,requireDeliveryWindow:true},
  binding:{verified:true,orderId:'90001',issueId:'80001',conversationId:'fixture-v3'},...extra};
}
const compile=(texts,extra={},prior=null)=>compileCustomerCase(input(texts,extra),prior);

test('an explicit schedule request preserves desire even when its clock is unclear',()=>{
 const c=compile(['Horario de entrega 10 a 3;30 por favor llamar antes']);assert.equal(c.wants_order,true);assert.equal(c.operational_action,'NONE');
});
test('a reported change of delivery day does not invent the missing new date',()=>{
 const c=compile(['Solo he cambiado el día de entrega']);assert.equal(c.wants_order,true);assert.equal(c.delivery_date,null);assert.ok(c.missing_information.includes('DELIVERY_DATE'));
});
test('an inability to use the product requires review without inferring return or renewed consent',()=>{
 const c=compile(['Quiero el pedido','No puedo usar este producto']);assert.equal(c.wants_return,false);assert.equal(c.wants_order,null);assert.equal(c.operational_action,'NONE');assert.equal(c.next_best_action,'HUMAN_REVIEW');
});

test('explicit pickup date wins over travel-return date in the same message',()=>{
 const c=compile(['No regreso hasta el 8, guárdenlo en GLS y el 9 lo recojo']);assert.equal(c.delivery_date,'2026-11-09');assert.equal(c.agency_requested,true);
});
test('recurring afternoon is retained while the morning clause describes work',()=>{
 const c=compile(['Quiero el pedido','En tardes por que trabajo en la mañana']);assert.equal(c.delivery_window,'AFTERNOON');
});
test('a precise current upper bound is preserved alongside a past-delivery complaint',()=>{
 const c=compile(['Ayer me dijeron otra cosa. Ahora voy estar en casa hasta las 18 h']);assert.equal(c.time_to,'18:00');
});
test('a denied morning attempt does not overwrite a future chosen day with a past report',()=>{
 const c=compile(['Mañana por la tarde','Esta mañana no he salido de casa, no es posible que no hubiese nadie, vengan por las tardes']);
 assert.equal(c.delivery_date,'2026-10-31');assert.equal(c.delivery_window,'AFTERNOON');assert.equal(c.reports_no_delivery_attempt,true);
});

test('a newly received date completes persisted window validity and retains the old record',()=>{
 const old=compile(['Por la mañana']);
 const later=compile(['Por la mañana','El sábado'],{now:Date.parse('2026-11-02T10:00:00Z')},old);
 assert.equal(later.delivery_window,null);assert.ok(later.fact_ledger.some(f=>f.fact_type==='DELIVERY_WINDOW'&&f.status==='SUPERSEDED'));
 assert.ok(later.fact_ledger.some(f=>f.fact_type==='DELIVERY_WINDOW'&&f.status==='EXPIRED'));
});
test('a precise upper bound expires at that Madrid time on the chosen date',()=>{
 const c=compile(['Hoy antes de las 12:00'],{now:Date.parse('2026-10-30T13:00:00Z')});
 assert.equal(c.time_to,null);assert.ok(c.fact_ledger.some(f=>f.fact_type==='TIME_TO'&&f.status==='EXPIRED'&&f.valid_until==='2026-10-30T11:00:00.000Z'));
});
test('a repeated compatible afternoon preference retains an already supplied precise interval',()=>{
 const c=compile(['El sábado por la tarde de 16 a 19','El sábado por la tarde']);assert.equal(c.time_from,'16:00');assert.equal(c.time_to,'19:00');
});

for(const [text,from,to]of [['a partir de las 15:15 de la tarde','15:15',null],['a partir de las 14.30del mediodía','14:30',null],['de 11 :30 ha 13:30','11:30','13:30'],['máximo 12:30h',null,'12:30']])test('minutes stay intact next to words: '+text,()=>{
 const c=compile(['Quiero el pedido el sábado',text]);assert.equal(c.time_from,from);assert.equal(c.time_to,to);
});
test('a later recurring window is not tied to an expired earlier day',()=>{
 const c=compile(['El viernes por la tarde',message('Que me lo dejen por las tardes',3*24*60)],{now:Date.parse('2026-11-02T15:00:00Z')});
 assert.equal(c.delivery_window,'AFTERNOON');assert.equal(c.delivery_date,null);
});

test('No answers the consent part of a combined consent/date question',()=>{
 const c=compile([message('¿Quiere que solicitemos una nueva entrega de su pedido? Si es así, indíquenos el día y la franja horaria.',0,'agent',{mid:'wamid.combined'}),message('No gracias',1)]);
 assert.equal(c.wants_return,true);assert.equal(c.wants_order,false);assert.equal(c.customer_reply_action,'NONE');
});
test('later supplied date scopes the previously supplied morning window',()=>{
 const c=compile(['Por la mañana','El sábado'],{now:Date.parse('2026-11-02T10:00:00Z')});
 assert.equal(c.delivery_window,null);assert.ok(c.fact_ledger.some(f=>f.fact_type==='DELIVERY_WINDOW'&&f.status==='EXPIRED'));
});

test('answered consent question is consumed before an unrelated later acknowledgment',()=>{
 const c=compile([message('¿Quiere el pedido?',0,'agent',{mid:'wamid.ask'}),message('No',1),message('Vale',2)]);
 assert.equal(c.wants_return,true);assert.equal(c.wants_order,false);assert.equal(c.active_outbound_question_type,null);
});
test('No to agency pickup declines only pickup, never the goods',()=>{
 const c=compile(['Quiero el pedido',message('¿Prefiere recoger en la oficina GLS?',1,'agent',{mid:'wamid.pickup'}),message('No',2)]);
 assert.equal(c.agency_requested,false);assert.equal(c.wants_order,true);assert.equal(c.wants_return,false);
});
test('unresolved work-end time survives a later contact instruction',()=>{
 const c=compile(['Quiero el pedido el sábado','cuando salga del trabajo','que me llamen']);
 assert.ok(c.missing_information.includes('TIME_FROM'));assert.equal(c.time_from,null);
});
test('an availability explanation cannot reverse an explicit refusal',()=>{
 const c=compile(['No quiero el pedido','Estoy de viaje hasta el día 8']);
 assert.equal(c.wants_order,false);assert.equal(c.wants_return,true);assert.equal(c.operational_action,'NONE');
});
for(const [text,date,window]of [['Mañana estaré en casa','2026-10-31',null],['por la mañana',null,'MORNING'],['MAÑANA POR MAÑANA/TARDE','2026-10-31',null]])test('date/window scope: '+text,()=>{
 const c=compile([text]);assert.equal(c.delivery_date,date);assert.equal(c.delivery_window,window);
});
for(const [text,from,to]of [['a partir de las 17h','17:00',null],['a partir de 12.15h','12:15',null],['de 11 :30 a 13:30','11:30','13:30'],['hasta las 18 h',null,'18:00']])test('clock normalization preserves bounds: '+text,()=>{
 const c=compile(['Quiero el pedido el sábado',text]);assert.equal(c.time_from,from);assert.equal(c.time_to,to);
});
test('work hours and unavailable morning cannot become requested morning delivery',()=>{
 const c=compile(['Quiero el pedido el sábado','Trabajo de 8 a 3 por la mañana. Por la tarde estaré en casa']);
 assert.equal(c.delivery_window,'AFTERNOON');assert.equal(c.time_from,null);assert.equal(c.time_to,null);assert.ok(!c.unresolved.includes('INVALID_TIME_RANGE'));
});
test('conditional acceptance never creates a high-confidence return instruction',()=>{
 const c=compile(['Si no es la oferta no me lo quedaré']);assert.notEqual(c.operational_action,'REQUEST_RETURN');
 assert.ok(!c.current_facts.WANTS_RETURN||c.current_facts.WANTS_RETURN.confidence<.9);
});
test('cluster compiles desire, Friday, afternoon and call-before into one case',()=>{
 const c=compile(['Sí quiero el pedido','viernes','por la tarde','llamadme antes','Hola']);
 assert.equal(c.wants_order,true);assert.equal(c.wants_return,false);assert.equal(c.delivery_date,'2026-10-30');assert.equal(c.delivery_window,'AFTERNOON');assert.equal(c.call_before_arrival,true);
 assert.equal(c.operational_action,'RETRY_DELIVERY');assert.equal(c.customer_reply_action,'NONE');assert.equal(c.owner,'existing_incident_action_gateway');
 assert.equal(c.fact_ledger.find(f=>f.fact_type==='CALL_BEFORE_ARRIVAL').authority,'CUSTOMER_DERIVED');
});
test('latest explicit refusal supersedes the old desire and delegates only to return owner',()=>{
 const c=compile(['Sí quiero el pedido','Mejor no, no lo quiero']);
 assert.equal(c.wants_return,true);assert.equal(c.wants_order,false);assert.equal(c.operational_action,'REQUEST_RETURN');assert.equal(c.customer_reply_action,'NONE');assert.equal(c.owner,'existing_return_workflow');
 assert.ok(c.fact_ledger.some(f=>f.fact_type==='WANTS_ORDER'&&f.value_json===true&&f.status==='SUPERSEDED'));
});
test('negated return and rejected discount cannot become goods refusal',()=>{
 const a=compile(['Sí quiero el pedido','No quiero devolverlo']);assert.equal(a.wants_return,false);assert.equal(a.wants_order,true);
 const b=compile(['No quiero el descuento, pero quiero el pedido']);assert.equal(b.wants_order,true);assert.equal(b.wants_return,false);assert.equal(b.discount_response,'REJECTED');assert.notEqual(b.operational_action,'REQUEST_RETURN');
});
for(const text of ['Nadie ha venido y sigo esperando','No se ha pasado nadie','No han intentado entregarlo','No me ha llegado'])test('non-delivery is not refusal: '+text,()=>{
 const c=compile([text]);assert.equal(c.wants_order,true);assert.equal(c.wants_return,false);assert.equal(c.reports_no_delivery_attempt,true);assert.notEqual(c.operational_action,'REQUEST_RETURN');
});
test('short answer uses preceding bound question and preserves known date',()=>{
 const c=compile(['El sábado',message('¿Prefiere mañana o tarde?',1,'agent',{mid:'wamid.question'}),message('Mañana',2)]);
 assert.equal(c.delivery_date,'2026-10-31');assert.equal(c.delivery_window,'MORNING');assert.deepEqual(c.missing_information,[]);
});
test('one unanswered question blocks every scheduler cycle, irrespective of elapsed cooldown',()=>{
 const messages=[message('Quiero el pedido el sábado'),message('¿Prefiere mañana o tarde?',1,'agent',{mid:'wamid.question'})];
 let c=compile(messages);
 for(const hours of [3,4,5,6]){c=compile(messages,{now:at+hours*3600000},c);assert.equal(c.next_best_action,'WAITING_CUSTOMER');assert.equal(c.customer_reply_action,'NONE');assert.equal(c.proposed_response,null);}
});
test('only the missing delivery window is asked, never desire/day/payment',()=>{
 const c=compile(['Quiero el pedido el sábado']);assert.deepEqual(c.missing_information,['TIME_WINDOW']);assert.match(c.proposed_response,/mañana o por la tarde/);assert.doesNotMatch(c.proposed_response,/efectivo|qué día|quiere el pedido/);
});
test('work-end restriction asks precisely for the unknown hour',()=>{
 const c=compile(['Quiero el pedido el sábado','cuando salga del trabajo']);assert.equal(c.wants_order,true);assert.deepEqual(c.missing_information,['TIME_FROM']);assert.equal(c.customer_reply_action,'CLARIFY');assert.match(c.proposed_response,/A partir de qué hora/);
});
for(const [text,from,to]of [['a las 17','17:00',null],['después de las 17','17:00',null],['antes de las 18',null,'18:00'],['entre 16 y 18','16:00','18:00']])test('precise clock: '+text,()=>{
 const c=compile(['Quiero el pedido el sábado',text]);assert.equal(c.time_from,from);assert.equal(c.time_to,to);
});
test('12-hour word clocks require a known window; no invented PM',()=>{
 const a=compile(['Quiero el pedido el sábado','a partir de las cinco']);assert.equal(a.time_from,null);assert.deepEqual(a.missing_information,['TIME_FROM']);
 const b=compile(['Quiero el pedido el sábado','por la tarde','a partir de las cinco']);assert.equal(b.time_from,'17:00');
});
for(const [text,date]of [['hoy','2026-10-30'],['mañana','2026-10-31'],['pasado mañana','2026-11-01'],['el día 5','2026-11-05'],['3 de noviembre','2026-11-03']])test('date from event: '+text,()=>assert.equal(compile([text]).delivery_date,date));
test('facts carry individual confidence and missing engine isolates a doubtful slot',()=>{
 const c=compile(['Quiero el pedido el sábado por la tarde']);c.current_facts.DELIVERY_WINDOW.confidence=.61;
 assert.deepEqual(requiredMissingInformation(c,'REDELIVERY'),['TIME_WINDOW']);assert.equal(c.current_facts.WANTS_ORDER.confidence,.99);
});
test('call-before is scoped to attempt; changing attempt cannot carry the preference',()=>{
 const c=compile(['Quiero el pedido el sábado','Llamadme antes'],{deliveryAttemptKey:'attempt-1'});
 const d=compile(['Quiero el pedido el sábado'],{deliveryAttemptKey:'attempt-2'},c);
 assert.equal(d.call_before_arrival,null);assert.ok(d.fact_ledger.some(f=>f.fact_type==='CALL_BEFORE_ARRIVAL'&&f.status==='EXPIRED'));
});
test('expired date is historical, not a valid retry day',()=>{
 const c=compile(['El viernes por la tarde'],{now:Date.parse('2026-11-01T12:00:00Z')});
 assert.equal(c.delivery_date,null);assert.ok(c.fact_ledger.some(f=>f.fact_type==='DELIVERY_DATE'&&f.status==='EXPIRED'));assert.ok(c.missing_information.includes('DELIVERY_DATE'));
});
test('irreversible provider action blocks a later change of mind',()=>{
 const c=compile(['Quiero el pedido'],{policy:{irreversibleAction:'RETURN_REQUESTED',lastVerifiedAction:{action:'RETURN_REQUESTED',status:'VERIFIED',at:'2026-10-30T09:00:00Z'}}});assert.equal(c.next_best_action,'HUMAN_REVIEW');assert.equal(c.operational_action,'NONE');assert.equal(c.proposed_response,null);
});
test('case hash is stable across scheduler time; edits/provider changes invalidate the plan',()=>{
 const a=compile(['Quiero el pedido el sábado por la tarde']);const b=compile(['Quiero el pedido el sábado por la tarde'],{now:now+60000},a);assert.equal(a.case_hash,b.case_hash);assert.doesNotThrow(()=>assertFreshCompilation(a,b));
 const c=compile(['No quiero el pedido'],{},b);assert.throws(()=>assertFreshCompilation(a,c),/STALE_PLAN/);
 const d=compile(['Quiero el pedido el sábado por la tarde'],{policy:{requireDeliveryDate:true,requireDeliveryWindow:true,irreversibleAction:'RETURN_REQUESTED'}},a);assert.throws(()=>assertFreshCompilation(a,d),/STALE_PLAN/);
});
test('edited evidence is retracted, retaining the complete historical record',()=>{
 const a=compile(['El sábado']);const b=compile(['El domingo'],{},a);
 assert.equal(b.delivery_date,'2026-11-01');assert.ok(b.fact_ledger.some(f=>f.fact_type==='DELIVERY_DATE'&&f.value_json==='2026-10-31'&&f.status==='RETRACTED'));
});
test('foreign order/issue/conversation blocks compilation and candidate injection',()=>{
 const x=input(['Quiero el pedido']);x.binding.orderId='99999';const c=compileCustomerCase(x);assert.equal(c.operational_action,'NONE');assert.equal(c.reason,'EXACT_ORDER_BINDING_REQUIRED');
 assert.equal(readCompiledIntent({...compile(['Quiero el pedido'])},input(['Quiero el pedido'])),null);
 const fresh=compile(['Quiero el pedido']);assert.throws(()=>readCompiledIntent(fresh,input(['No lo quiero'])),/STALE_PLAN/);
});
test('existing candidate engine remains identical with no V3 argument',()=>{
 const x=input(['Quiero el pedido el sábado por la tarde']);assert.deepEqual(resolutionCandidate(x),resolutionCandidate({...x,conversationContext:{operational_action:'REQUEST_RETURN'}}));
 const c=compileCustomerCase(x);assert.equal(resolutionCandidate({...x,conversationContext:c}).twin.order_id,'90001');
});
test('LLM contract cannot assert authority/actions, unknown fields or unbound evidence',()=>{
 const e={source_event_hash:hash('known')},good={facts:[{type:'WANTS_ORDER',value:true,confidence:.99,evidence_hash:e.source_event_hash}],contradictions:[],unresolved:[]};
 assert.doesNotThrow(()=>validateCustomerFacts(good,[e]));
 for(const field of ['authority','action','claim_acquired'])assert.throws(()=>validateCustomerFacts({...good,facts:[{...good.facts[0],[field]:'SYSTEM_CONTROLLED'}]},[e]));
 assert.throws(()=>validateCustomerFacts({...good,facts:[{...good.facts[0],type:'RETURN_REQUESTED'}]},[e]));
 assert.throws(()=>validateCustomerFacts(good,[]),/UNBOUND/);
});
test('semantic fallback cannot run with zero budget, and trivial messages never call it',async()=>{
 let calls=0;const interpret=async()=>{calls++;throw Error('must not call');};
 await semanticFallback({unresolved:['UNKNOWN']},[],{enabled:true,budgetUsd:0,interpret});
 await semanticFallback({unresolved:[],confidence:1},[],{enabled:true,budgetUsd:10,interpret});assert.equal(calls,0);
 const safe=compileSemanticContext({current_facts:{},unresolved:[]},[{direction:'INBOUND',text:'Teléfono 600111222 y a@example.com',source_event_hash:hash('x')}]);assert.doesNotMatch(JSON.stringify(safe),/600111222|a@example/);
});
test('generated Ajv validator is pinned to the checked-in schema',()=>{
 const generated=readFileSync(new URL('./fact-validator.generated.mjs',import.meta.url),'utf8');assert.ok(generated.includes(hash(factOutputSchema)));assert.doesNotMatch(generated,/require\(/);
});
test('disabled observer does not read, persist, send or alter legacy items',async()=>{
 const items=[input(['Quiero el pedido'])],before=structuredClone(items);
 const result=await observeConversationV3(items,{env:{},store:{load:()=>{throw Error('must not run');}}});assert.deepEqual(result,{enabled:false});assert.deepEqual(items,before);
});
test('SHADOW observer persists comparison without any sender or provider writer',async()=>{
 const items=[input(['Quiero el pedido el sábado por la tarde'])];let saves=0;
 const result=await observeConversationV3(items,{env:{CONVERSATION_V3_ENABLED:'true'},now,policyFor:i=>i.policy,store:{load:async()=>null,save:async c=>{saves++;assert.equal(c.mode,'SHADOW');}}});
 assert.equal(result.failures,0);assert.equal(saves,1);assert.equal(result.provider_writes,0);
});
test('SHADOW read failure preserves valid memory and reports failure rather than a successful empty context',async()=>{
 const item=input(['Quiero el pedido el sábado por la tarde']);item.incident.chatbyReadVerified=false;
 const previous=compile(['Quiero el pedido el sábado por la tarde']);const frozen=structuredClone(previous);let writes=0;
 const result=await observeConversationV3([item],{env:{CONVERSATION_V3_ENABLED:'true'},now,policyFor:i=>i.policy,store:{load:async()=>({value:previous}),save:async()=>{writes++;}}});
 assert.equal(result.failures,1);assert.equal(result.metrics.cases,0);assert.equal(result.provider_writes,0);assert.equal(writes,0);assert.deepEqual(previous,frozen);
 assert.equal(item.incident.conversationIntelligenceV3,undefined);
});
test('300 synthetic cases cannot satisfy the genuinely sourced reviewed release gate',()=>{
 const failed=evaluateConversationRelease({real_cases:0,reviewed_real_cases:0,synthetic_cases:1000});assert.equal(failed.allowed,false);
 const good={real_cases:300,reviewed_real_cases:300,provenance_verified:true,wrong_irreversible_route:0,wrong_order_binding:0,repeated_clarification:0,blind_retry:null,owner_routing:1,explicit_return_recall:1,explicit_order_recall:1,date_window_accuracy:.99,current_replay_verified:true,executor_reconciliation_contract_verified:true,unknown_execution_no_blind_retry_tests:true};assert.equal(evaluateConversationRelease(good).allowed,true);
 for(const field of ['wrong_irreversible_route','wrong_order_binding','repeated_clarification'])assert.equal(evaluateConversationRelease({...good,[field]:1}).allowed,false);
});
test('provider changes and mutation after compilation cannot reuse a branded intent',()=>{
 const x=input(['Quiero el pedido el sábado por la tarde']),c=compileCustomerCase(x);
 assert.throws(()=>readCompiledIntent(c,{...x,order:{...x.order,status:'RETURNED'}}),/STALE_PLAN/);
 c.wants_return=true;assert.throws(()=>readCompiledIntent(c,x),/MUTATED/);
});
test('precise time is preserved for the existing literal solution contract',()=>{
 const x=input(['Quiero el pedido el sábado por la tarde','a partir de las 17']);const c=compileCustomerCase(x);
 const r=readCompiledIntent(c,x);assert.equal(r.slot.time_window,null);assert.match(r.literal_delivery_preference.literal,/17/);
 const candidate=resolutionCandidate({...x,conversationContext:c});assert.notEqual(candidate.twin.resolution_plan?.action,'RETRY_DELIVERY');
});
test('a new morning preference supersedes a previous exact afternoon clock',()=>{
 const c=compile(['Quiero el pedido el sábado','a las 17','mejor por la mañana']);
 assert.equal(c.delivery_window,'MORNING');assert.equal(c.time_from,null);
 assert.ok(c.fact_ledger.some(f=>f.fact_type==='TIME_FROM'&&f.status==='SUPERSEDED'));
});
test('existing default-schedule policy is preserved and expired dates do not gain a new default',()=>{
 const policy={requireDeliveryDate:true,requireDeliveryWindow:true,ownerProvidesDefaultSchedule:true,ownerProvidesDefaultDate:true};
 assert.deepEqual(compile(['Quiero el pedido'],{policy}).missing_information,[]);
 const expired=compile(['El viernes por la tarde'],{policy,now:Date.parse('2026-11-01T12:00:00Z')});assert.ok(expired.missing_information.includes('DELIVERY_DATE'));
});
test('address extraction admits only typed customer fields and retains unit details',()=>{
 const c=compile(['Calle Ejemplo 10, 2º B, 28001 Madrid']);assert.ok(c.fact_ledger.some(f=>f.fact_type==='ADDRESS'));
});
test('verified exact-order buttons are interpreted before text, and foreign reply references block',()=>{
 const x=input([message('Seleccionado',0,'in',{raw:{button_verified:true,order_id:'90001',button_payload:'ABSENT_TOMORROW_AFTERNOON'}})]);
 const c=compileCustomerCase(x);assert.equal(c.delivery_date,'2026-10-31');assert.equal(c.delivery_window,'AFTERNOON');assert.equal(c.current_facts.DELIVERY_WINDOW.confidence,1);
 const y=compile([message('Sí',0,'in',{payload:{reply_to_mid:'wamid.foreign'}})]);assert.equal(y.next_best_action,'HUMAN_REVIEW');
});
test('V3 canary requires reviewed release evidence, exact case and independent capability',()=>{
 const legacy={eligible:true,kind:'CLARIFY',content:'legacy'},x=input(['Quiero el pedido el sábado']);
 const env={CONVERSATION_V3_ENABLED:'true',CONVERSATION_INTELLIGENCE_V3_MODE:'CANARY',CONVERSATION_V3_CLARIFICATION_ENABLED:'true'};
 const releaseReport={real_cases:300,reviewed_real_cases:300,provenance_verified:true,wrong_irreversible_route:0,wrong_order_binding:0,repeated_clarification:0,blind_retry:null,owner_routing:1,explicit_return_recall:1,explicit_order_recall:1,date_window_accuracy:.99,current_replay_verified:true,executor_reconciliation_contract_verified:true,unknown_execution_no_blind_retry_tests:true};
 assert.equal(decorateConversationV3(legacy,x,{env,canaryCase:'90001:80001'}).plan,legacy);
 assert.equal(decorateConversationV3(legacy,x,{env,releaseReport,canaryCase:'other'}).plan,legacy);
 const result=decorateConversationV3(legacy,x,{env,releaseReport,canaryCase:'90001:80001'});assert.match(result.plan.content,/mañana o por la tarde/);
 const waiting={...x,messages:[...x.messages,message('¿Prefiere mañana o tarde?',1,'agent',{mid:'wamid.question'})]};
 assert.equal(decorateConversationV3(legacy,waiting,{env,releaseReport,canaryCase:'90001:80001'}).plan.eligible,false);
 for(const mode of ['SHADOW','LIVE'])assert.equal(decorateConversationV3(legacy,x,{env:{...env,CONVERSATION_INTELLIGENCE_V3_MODE:mode},releaseReport,canaryCase:'90001:80001'}).plan,legacy);
 const solution={eligible:true,kind:'SOLUTION',hash:'original'};assert.equal(decorateConversationV3(solution,x,{env,releaseReport,canaryCase:'90001:80001'}).plan,solution);
});
test('duplicated provider display text does not create multiple clocks or erase courtesy context',()=>{
 const c=compile(['Quiero el pedido el sábado Quiero el pedido el sábado','entre 16 y 18 entre 16 y 18','Gracias Gracias']);assert.equal(c.wants_order,true);assert.equal(c.time_from,'16:00');assert.equal(c.time_to,'18:00');assert.deepEqual(c.unresolved,[]);
});
test('a delivery question is not a new date preference',()=>{
 const c=compile(['¿Mañana llegará el paquete?']);assert.equal(c.delivery_date,null);assert.equal(c.current_facts.ASKS_DELIVERY_DATE.value_json,true);assert.equal(c.operational_action,'NONE');
});
test('customer-reported receipt/carrier promise is not provider verified delivery or a retry request',()=>{
 for(const text of ['Lo he recibido hoy','El repartidor me dijo que vendría mañana']){
  const c=compile([text]);assert.equal(c.delivery_date,null);assert.equal(c.operational_action,'NONE');assert.equal(c.next_best_action,'WAITING_PROVIDER');assert.equal(c.last_verified_action,null);
 }
});
test('an inactive incident preserves context but never prepares another operation or clarification',()=>{
 const x=input(['Quiero el pedido el sábado']);x.issue.raw.is_active=false;const c=compileCustomerCase(x);assert.equal(c.wants_order,true);assert.equal(c.operational_action,'NONE');assert.equal(c.customer_reply_action,'NONE');assert.equal(c.next_best_action,'WAITING_PROVIDER');
});
test('inactive issue cannot regain a clarification through a doubtful work-end time',()=>{
 const x=input(['Quiero el pedido el sábado','cuando salga del trabajo']);x.issue.raw.is_active=false;const c=compileCustomerCase(x);assert.equal(c.customer_reply_action,'NONE');assert.deepEqual(c.missing_information,[]);
});
test('availability tied to an expired day expires together with that day',()=>{
 const c=compile(['El viernes por la tarde','Llamadme antes'],{now:Date.parse('2026-11-01T12:00:00Z')});assert.equal(c.delivery_date,null);assert.equal(c.delivery_window,null);assert.equal(c.call_before_arrival,null);
});
test('written dates and an explicit no-longer-needed refusal retain their meaning',()=>{
 const c=compile(['Lo quiero para el día diez de noviembre']);assert.equal(c.delivery_date,'2026-11-10');assert.equal(c.wants_order,true);
 const d=compile(['Ya no necesito el pedido']);assert.equal(d.wants_return,true);assert.equal(d.wants_order,false);
});
test('a later delivery instruction preserves unanswered product support for source verification',()=>{
 const c=compile(['¿Qué producto es?','Quiero el pedido el sábado por la tarde']);assert.equal(c.current_facts.ASKS_PRODUCT.value_json,true);assert.ok(c.pending_customer_questions.some(q=>q.type==='ASKS_PRODUCT'));assert.equal(c.reason,'VERIFIED_PRODUCT_SOURCE_REQUIRED');
 const question=compile(['¿Qué producto es?']);assert.deepEqual(question.missing_information,[]);assert.equal(question.next_best_action,'HUMAN_REVIEW');
});
test('latest discount decision supersedes both sides of a previous acceptance/refusal',()=>{
 const offer=message('Descuento',0,'agent',{mid:'wamid.offer',payload:{name:'es_es_dropea_incidencia_descuento_5_v1'}});
 const c=compile([offer,message('Quiero el descuento',1),message('No quiero el pedido',2)]);assert.equal(c.discount_response,'REJECTED');assert.equal(c.current_facts.ACCEPTS_DISCOUNT.value_json,false);
 const d=compile([offer,message('No quiero el pedido',1),message('Quiero el descuento',2)]);assert.equal(d.discount_response,'ACCEPTED');assert.equal(d.wants_return,false);assert.equal(d.current_facts.REJECTS_DISCOUNT.value_json,false);
});
test('two explicit availability intervals remain literal and use only the existing solution contract',()=>{
 const x=input(['Horario de días laborables: de 10h a 14h y de 17h a 20h']);x.policy.ownerProvidesDefaultDate=true;
 const c=compileCustomerCase(x);assert.equal(c.wants_order,true);assert.ok(c.current_facts.DELIVERY_AVAILABILITY);assert.equal(c.operational_action,'RETRY_DELIVERY');
 const response=readCompiledIntent(c,x);assert.match(response.literal_delivery_preference.literal,/10h.*14h.*17h.*20h/);
 const candidate=resolutionCandidate({...x,conversationContext:c});assert.equal(candidate.twin.next_best_action,'PROVIDE_SOLUTION');
});
test('hour suffixes and a precise clock after a window are retained',()=>{
 const c=compile(['Quiero el pedido el sábado','de 14h hasta 17h']);assert.equal(c.wants_order,true);
 const d=compile(['Quiero el pedido el sábado','de 14h a 17h']);assert.equal(d.time_from,'14:00');assert.equal(d.time_to,'17:00');
 const e=compile(['por la tarde 16:00']);assert.equal(e.time_from,'16:00');
});
test('reply and operational decisions are independent, and an acknowledgment needs fresh verified action evidence',()=>{
 const policy={requireDeliveryDate:true,requireDeliveryWindow:true,lastVerifiedAction:{action:'RETRY_DELIVERY',status:'VERIFIED',at:'2026-10-30T11:00:00Z'},providerReadVerified:true,providerReadAt:new Date(now-1000).toISOString()};
 const c=compile(['Quiero el pedido el sábado por la tarde'],{policy});assert.equal(c.operational_action,'NONE');assert.equal(c.customer_reply_action,'ACKNOWLEDGE_REQUEST');assert.match(c.proposed_response,/solicitado una nueva entrega/);assert.doesNotMatch(c.proposed_response,/llegará|entregado/);
 const d=compile(['Quiero el pedido el sábado por la tarde'],{policy},{...c,acknowledged_action_hash:c.ack_action_hash});assert.equal(d.customer_reply_action,'NONE');
 const stale=compile(['Quiero el pedido el sábado por la tarde'],{policy:{...policy,providerReadAt:new Date(now-120000).toISOString()}});assert.equal(stale.customer_reply_action,'NONE');
});
test('a newer unknown question prevents an old yes/no question from consuming the answer',()=>{
 const c=compile([message('¿Quiere el pedido?',0,'agent',{mid:'wamid.want'}),message('¿Ha recibido el SMS?',1,'agent',{mid:'wamid.sms'}),message('No',2)]);
 assert.notEqual(c.wants_return,true);assert.equal(c.operational_action,'NONE');
});
test('cash availability alone is never an active missing requirement',()=>{
 const c=compile(['Quiero el pedido el sábado por la tarde',message('Confirme que dispondrá de efectivo',1,'agent',{mid:'wamid.cash'})]);
 assert.equal(c.operational_action,'RETRY_DELIVERY');assert.equal(c.customer_reply_action,'NONE');assert.ok(c.clarifications.some(q=>q.status==='INFORMATIONAL_NOT_REQUIRED'));
 const mixed=compile(['Quiero el pedido',message('Confirme que dispondrá de efectivo e indique día y franja horaria',1,'agent',{mid:'wamid.cash-schedule'})]);
 assert.equal(mixed.next_best_action,'WAITING_CUSTOMER');assert.equal(mixed.proposed_response,null);
});
