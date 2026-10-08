import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCustomerIntentV2,currentCustomerIntent,deliverySlot} from './incident-intent-v2.mjs';
import {resolutionCandidate,resolutionMetrics,stuckFindings,logisticsFollowUp} from './incident-resolution-plan.mjs';
import {executeResolutionCandidate,resolutionCapabilityMode} from './incident-resolution-executor.mjs';
import {createResolutionStore} from './incident-resolution-store.mjs';
import {runIncidentResolutionCycle} from './incident-resolution-runtime.mjs';
const now=Date.parse('2026-10-03T12:00:00Z'),at=now-60000;
const message=(text,id=3,ts=at)=>({id,type:'in',ts:ts/1000,payload:{text}});
function input(type='rejected_goods',text='Mañana por la mañana'){
  const notice={rejected_goods:'dropea_incidencia_mercancia_v1',absent:'dropea_ausente_v3',address:'dropea_incidencia_direccion_v1'}[type];
  return {now,incident:{orderId:'101',incidenceId:'201',incidentType:type,incidenceDate:'2026-10-02T08:00:00Z',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',chatbyUserNs:'fixture',incidentResponseDeadlineAt:'2026-10-04T08:00:00Z'},
    order:{orderId:'101',createdAt:'2026-10-01T08:00:00Z',status:'INCIDENCE',customerPhone:'600000000',raw:{shipping_address:{country:'ES',city:'Madrid',state:'Madrid',zip:'28001',address:'Calle Prueba 1'}}},
    issue:{id:'201',order_id:'101',is_active:true,status:'PENDING',type:{rejected_goods:'REFUSED_BY_RECIPIENT',absent:'RECIPIENT_ABSENT',address:'ADDRESS_INCORRECT'}[type],allowed_resolution_options:['RETRY','RETURN_REQUESTED','PROVIDE_SOLUTION','PICKUP_AT_AGENCY','CHANGE_ADDRESS']},
    messages:[{id:1,type:'agent',ts:Date.parse('2026-10-02T08:01:00Z')/1000,mid:'wamid.fixtureNotice',payload:{name:notice}},{id:2,type:'agent',ts:Date.parse('2026-10-03T08:01:00Z')/1000,mid:'wamid.fixtureOffer',payload:{name:'es_es_dropea_incidencia_descuento_5_v1'}},...(text?[message(text)]:[])]};
}
test('rejected acceptance is composable and prepares the complete plan without inventing economic support',()=>{
 const c=resolutionCandidate(input('rejected_goods','Sí, quiero el pedido con los 5 euros'));
 assert.deepEqual(c.response.intents,['ACCEPTS_DISCOUNT','WANTS_ORDER']);
 assert.deepEqual(c.twin.resolution_plan.steps.map(s=>s.action),['APPLY_DISCOUNT','VERIFY_DISCOUNT','RETRY_DELIVERY','VERIFY_RETRY','WAIT_LOGISTICS_OUTCOME']);
 assert.equal(c.twin.human_review_reason,'DISCOUNT_ECONOMIC_MUTATION_CONTRACT_UNAVAILABLE');assert.equal(c.twin.verification_status,'NOT_REQUESTED');
});
test('rejecting discount does not reject order; missing slot is explicit review',()=>{
 const c=resolutionCandidate(input('rejected_goods','quiero el pedido pero sin descuento'));
 assert.ok(c.response.intents.includes('WANTS_ORDER'));assert.ok(c.response.intents.includes('REJECTS_DISCOUNT'));
 assert.equal(c.action,'RETRY_DELIVERY');assert.equal(c.twin.human_review_reason,'DELIVERY_DATE_AND_WINDOW_REQUIRED');
});
test('explicit rejected return prepares only return, with no recovery',()=>{
 const c=resolutionCandidate(input('rejected_goods','ya no lo quiero, devolver'));
 assert.equal(c.action,'REQUEST_RETURN');assert.deepEqual(c.twin.resolution_plan.steps.map(s=>s.action),['REQUEST_RETURN']);
});
for(const [text,window]of [['Mañana por la mañana','morning'],['Mañana por la tarde','afternoon'],['2026-10-07 por la tarde','afternoon'],['7 de octubre por la mañana','morning']])test(`absent date ${text}`,()=>{
 const c=resolutionCandidate(input('absent',text));assert.equal(c.action,'RETRY_DELIVERY');assert.equal(c.data.time_window,window);assert.equal(c.providerPlan.allowed,true);
});
test('relative dates use message Madrid day across UTC midnight and DST',()=>{
 const slot=deliverySlot('Mañana por la mañana',Date.parse('2026-10-24T23:30:00Z'));assert.equal(slot.date,'2026-10-26');
});
test('ambiguous dates, multiple windows and exact hours cannot become an invented slot',()=>{
 for(const text of ['lunes o martes por la tarde','mañana por la mañana y por la tarde','2026-02-30 por la mañana','mañana a las 10:00','mañana por la mañana a las 10'])assert.equal(deliverySlot(text,at).time_window,null,text);
});
test('absent agency checks current provider capability',()=>{
 const i=input('absent','quiero recoger en agencia');assert.equal(resolutionCandidate(i).action,'PICKUP_AT_AGENCY');i.issue.allowed_resolution_options=[];assert.equal(resolutionCandidate(i).twin.human_review_reason,'CAPABILITY_NOT_ALLOWED');
});
test('explicit absent return is prepared under its own capability; discount and silence remain separate',()=>{
 assert.equal(resolutionCandidate(input('absent','devolver')).action,'REQUEST_RETURN');
 assert.equal(resolutionCandidate(input('absent','devolver')).twin.human_review_reason,null);
 assert.equal(resolutionCandidate(input('absent','acepto el descuento')).twin.human_review_reason,'ABSENT_DISCOUNT_APPLICATION_POLICY_REQUIRED');
 const c=resolutionCandidate({...input('absent',''),now:now+3*86400000});assert.notEqual(c.action,'REQUEST_RETURN');
});
test('address complete uses solution note with call-before-delivery',()=>{
 const c=resolutionCandidate(input('address','Calle Nueva 25, 28001 Madrid, provincia Madrid, país ES'));
 assert.equal(c.action,'PROVIDE_SOLUTION');assert.equal(c.providerPlan.allowed,true);assert.match(c.providerPlan.body.resolution_note,/antes de la entrega/);
});
test('address partial suppresses initial silence actions after reply',()=>{
 const c=resolutionCandidate(input('address','Calle Nueva 25'));
 assert.ok(c.twin.human_review_reason);assert.notEqual(c.action,'OFFER_DISCOUNT');assert.notEqual(c.action,'REQUEST_RETURN');
});
test('address accepted discount stays manual',()=>{
 assert.equal(resolutionCandidate(input('address','quiero el pedido con los 5 euros')).twin.human_review_reason,'MANUAL_DISCOUNT_RECOVERY');
});
test('exact association, other order, missing timestamp and future events fail closed',()=>{
 for(const edit of [i=>i.incident.chatbyOrderAssociation='PHONE',i=>i.order.orderId='other',i=>i.messages[2].order_id='other',i=>delete i.messages[2].ts,i=>i.messages[2].ts=(now+1)/1000]){const i=input();edit(i);assert.equal(currentCustomerIntent(i).status,'NOT_VERIFIABLE');}
});
test('late relevant intent wins; greeting does not erase it; duplicate is idempotent',()=>{
 const i=input();i.messages.push(message('mejor devolver',4,at+1000),message('gracias',5,at+2000));
 assert.deepEqual(currentCustomerIntent(i).intents,['WANTS_RETURN']);
 const p=resolutionCandidate(i).twin;i.messages.push(i.messages[3]);const after=resolutionCandidate({...i,previous:p,now:now+1000}).twin;assert.equal(after.resolution_plan.plan_id,p.resolution_plan.plan_id);assert.equal(after.resolution_plan.created_at,p.resolution_plan.created_at);
});
test('later ambiguous response blocks earlier actionable request; simultaneous conflict blocks',()=>{
 const i=input();i.messages.push(message('no sé, quizá',4,at+1000));assert.ok(resolutionCandidate(i).twin.human_review_reason);
 const j=input();j.messages.push(message('devolver',4,at));assert.equal(currentCustomerIntent(j).status,'NOT_VERIFIABLE');
});
test('plan supersession retains history and stops after irreversible action',()=>{
 const i=input(),p=resolutionCandidate(i).twin;i.messages.push(message('mejor devolver',4,at+1000));
 let t=resolutionCandidate({...i,previous:p}).twin;assert.equal(t.plan_history[0].status,'SUPERSEDED');
 p.resolution_plan.steps[0].status='VERIFIED';t=resolutionCandidate({...i,previous:p}).twin;assert.equal(t.human_review_reason,'INTENT_CHANGED_AFTER_ACTION_RECONCILE');
});
function harness(i){
 let writes=0,reads=0,claims=0;let current={issue:i.issue,order:i.order};
 const env={INCIDENT_E2E_REJECTED_RETRY_DELIVERY_MODE:'CANARY',INCIDENT_E2E_REJECTED_RETRY_DELIVERY_BREAKER:'CLOSED',INCIDENT_E2E_REJECTED_RETRY_DELIVERY_ISSUE_ID:'201'};
 const deps={env,now:()=>now,readCurrent:async()=>{reads++;return current;},readMessages:async()=>i.messages,verifyConversation:async()=>true,priorConflict:async()=>false,claim:async()=>{claims++;return {acquired:true,persistent:true};},finish:async()=>{},write:async()=>{writes++;current={...current,issue:{...i.issue,status:'RESOLVED',resolution_status:'RETRY',resolution_data:{date:'2026-10-04',time_window:'morning'}}};}};
 return {deps,get writes(){return writes;},get claims(){return claims;},get reads(){return reads;}};
}
test('canary reads before/after claim, writes once and verifies provider state',async()=>{
 const i=input(),h=harness(i),r=await executeResolutionCandidate(i,resolutionCandidate(i),h.deps);assert.equal(r.verified,true);assert.equal(h.writes,1);assert.equal(h.reads,3);
});
test('late customer reply after claim blocks write',async()=>{
 const i=input(),h=harness(i);h.deps.claim=async()=>{i.messages.push(message('mejor devolver',4,at+1000));return {acquired:true,persistent:true};};
 const r=await executeResolutionCandidate(i,resolutionCandidate(i),h.deps);assert.equal(h.writes,0);assert.equal(r.reason,'LATE_EVIDENCE_OR_BREAKER_CHANGE');
});
test('HTTP success without changed provider state remains UNKNOWN',async()=>{
 const i=input(),h=harness(i);h.deps.write=async()=>({ok:true});const r=await executeResolutionCandidate(i,resolutionCandidate(i),h.deps);assert.equal(r.status,'UNKNOWN');
});
test('timeout and provider conflict reconcile without retry',async()=>{
 for(const message of ['timeout','409 conflict']){const i=input(),h=harness(i);let posts=0;h.deps.write=async()=>{posts++;throw Error(message);};const r=await executeResolutionCandidate(i,resolutionCandidate(i),h.deps);assert.equal(r.status,'UNKNOWN');assert.equal(posts,1);}
});
test('existing claim is never retried; historical cases never execute',async()=>{
 const i=input(),h=harness(i);h.deps.claim=async()=>({acquired:false,persistent:true});assert.equal((await executeResolutionCandidate(i,resolutionCandidate(i),h.deps)).status,'UNKNOWN');assert.equal(h.writes,0);
 assert.equal((await executeResolutionCandidate({...i,historical:true},resolutionCandidate(i),h.deps)).reason,'HISTORICAL_EXECUTION_FORBIDDEN');
});
test('capabilities need explicit closed breaker, exact canary and verified promotion',()=>{
 assert.equal(resolutionCapabilityMode('REJECTED','RETRY_DELIVERY','201',{}),'SHADOW');const h=harness(input());assert.equal(resolutionCapabilityMode('REJECTED','RETRY_DELIVERY','202',h.deps.env),'SHADOW');h.deps.env.INCIDENT_E2E_REJECTED_RETRY_DELIVERY_MODE='LIVE';assert.equal(resolutionCapabilityMode('REJECTED','RETRY_DELIVERY','201',h.deps.env),'SHADOW');
});
test('every active twin has exactly one route and every wait has a deadline',()=>{
 for(const type of ['rejected_goods','absent','address'])for(const text of ['','hola','quiero el pedido con los 5 euros','devolver','Mañana por la mañana']){const t=resolutionCandidate(input(type,text)).twin;assert.equal([t.next_best_action,t.explicit_wait_until,t.human_review_reason].filter(Boolean).length,1);if(t.explicit_wait_until)assert.ok(t.timer_state.on_timeout_action);}
});
test('stuck engine reports missing execution, missing verification and expired wait',()=>{
 const t={customer_replied:true,execution_status:'UNKNOWN',verification_status:'UNKNOWN',timer_state:{deadline:'2020-01-01'}};assert.equal(stuckFindings(t,now)[0].reasons.length,3);
});
test('logistics terminal state and new issue are verified separately from message sends',()=>{
 const t=resolutionCandidate(input()).twin;assert.equal(t.logistics_outcome,'STILL_PENDING');const r=logisticsFollowUp(t,{order:{orderId:'101',status:'DELIVERED'}},{now});assert.equal(r.logistics_outcome,'DELIVERED');assert.equal(r.verification_status,'VERIFIED');assert.equal(logisticsFollowUp(t,{order:{orderId:'101',status:'INCIDENCE'}},{newIssueId:'202',now}).logistics_outcome,'NEW_INCIDENT');
});
test('metrics define denominator and unknown zero-denominator rates',()=>{
 const empty=resolutionMetrics([]);assert.equal(empty.autonomous_resolution_rate,null);const t=resolutionCandidate(input('rejected_goods','acepto el descuento')).twin;const m=resolutionMetrics([t]);assert.equal(m.customer_replied_unresolved,1);assert.equal(m.stuck,1);assert.equal(m.autonomous_resolution_rate,0);
});
test('durable store paginates and appends event before projection',async()=>{
 const calls=[];const store=createResolutionStore({enabled:()=>true,select:async(t,{query})=>query.offset===0?Array.from({length:500},()=>({value:{}})):[{value:{last:true}}],insert:async()=>calls.push('event'),upsert:async()=>calls.push('projection')});assert.equal((await store.load()).length,501);await store.save(resolutionCandidate(input()).twin);assert.deepEqual(calls,['event','projection']);
});
test('runtime SHADOW observer never calls provider write and keeps old automation separate',async()=>{
 const i=input(),saved=[];const r=await runIncidentResolutionCycle([i],{store:{load:async()=>[],save:async t=>saved.push(t)},env:{},now,executorAdapters:{write:()=>assert.fail('NO_WRITE')}});assert.equal(r.failures,0);assert.equal(saved.length,1);assert.equal(r.metrics.customer_replied_unresolved,1);assert.equal(i.incident.incidentResolution.capability_blocker,'CAPABILITY_SHADOW');
});
test('confirmed original address prepares a solution with existing address',()=>{
 const c=resolutionCandidate(input('address','Confirmo la dirección correcta'));assert.equal(c.action,'PROVIDE_SOLUTION');assert.equal(c.providerPlan.allowed,true);
});
test('ambiguous later reply preserves action history and requires reconciliation',()=>{
 const i=input(),p=resolutionCandidate(i).twin;p.resolution_plan.steps[0].status='UNKNOWN';i.messages.push(message('no sé, quizá',4,at+1000));const t=resolutionCandidate({...i,previous:p}).twin;assert.equal(t.human_review_reason,'INTENT_CHANGED_AFTER_ACTION_RECONCILE');assert.equal(t.plan_history.length,1);
});
test('unknown write stays unknown until exact independent action evidence',()=>{
 const t=resolutionCandidate(input()).twin;t.execution_status='UNKNOWN';t.resolution_plan.steps[0].status='UNKNOWN';
 const pending=logisticsFollowUp(t,{order:{orderId:'101',status:'INCIDENCE'},issue:{id:'201',order_id:'101',status:'PENDING'}},{now});assert.equal(pending.next_best_action,'RECONCILE_PROVIDER');assert.equal(pending.explicit_wait_until,null);
 const current={order:{orderId:'101',status:'IN_TRANSIT'},issue:{id:'201',order_id:'101',status:'RESOLVED',resolution_status:'RETRY',resolution_data:{date:'2026-10-04',time_window:'morning'}}};
 assert.equal(logisticsFollowUp(t,current,{now}).execution_status,'VERIFIED');current.issue.order_id='102';assert.equal(logisticsFollowUp(t,current,{now}).execution_status,'UNKNOWN');
});
