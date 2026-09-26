import test from 'node:test';
import assert from 'node:assert/strict';
import { rejectedIntent,rejectedDecisionSnapshot,rejectedRuntimeStatus } from './recipient-rejected-policy.mjs';
import { classifyIncidentDiscountResponse } from './incident-discount-policy.mjs';
const delivery={status:'sent',sent_at:'2026-09-20T10:00:00Z'};
const m=(text,time='2026-09-20T11:00:00Z')=>({direction:'inbound',created_at:time,text});
test('rejection intent separates order, discount and ambiguity',()=>{
 for(const text of ['Sí quiero el pedido','Quiero recibirlo','Que me lo vuelvan a llevar','Sí, mañana estoy']) assert.equal(rejectedIntent(text).wants_order,true,text);
 for(const text of ['Devolver','No lo quiero','Ya no quiero recibirlo','He tenido que marcharme, devolver']) assert.equal(rejectedIntent(text).requests_return,true,text);
 for(const text of ['Ahora no','No sé','Ya veremos','No estaba','Me pilló fuera','Quizá mañana','ahora no puedo','no sé si lo quiero']) assert.equal(rejectedIntent(text).requests_return,false,text);
 const mixed=rejectedIntent('No quiero descuento pero sí quiero el pedido');assert.equal(mixed.wants_order,true);assert.equal(mixed.discount_accepted,false);assert.equal(mixed.requests_return,false);
 assert.equal(rejectedIntent('no lo he pedido',{previouslyConfirmed:true}).reason,'CURRENT_ORDER_PREVIOUSLY_CONFIRMED');
 assert.equal(rejectedIntent('Acepto',{offerVerified:true}).discount_accepted,true);assert.equal(rejectedIntent('Acepto').discount_accepted,false);
});
test('latest dated reply wins regardless of provider ordering',()=>{
 const result=classifyIncidentDiscountResponse([m('mejor sí quiero recibirlo','2026-09-20T12:00:00Z'),m('devolver')],'fixture',delivery);
 assert.equal(result.status,'OTHER_RESPONSE');assert.equal(result.wants_order,true);
 assert.equal(classifyIncidentDiscountResponse([m('devolver'),m('no sé','2026-09-20T12:00:00Z')],'fixture',delivery).status,'OTHER_RESPONSE');
 assert.equal(classifyIncidentDiscountResponse([m('devolver'),{direction:'inbound',text:'sin fecha'}],'fixture',delivery).status,'OTHER_RESPONSE');
});
test('decision hashes are reproducible and do not persist conversations',()=>{
 const args={incident:{orderId:'fixture-order',incidenceId:'fixture-issue',chatbyUserNs:'fixture-conversation',chatbyReadVerified:true},response:rejectedIntent('devolver'),recovery:{},now:0};
 const d=rejectedDecisionSnapshot(args);assert.equal(d.next_best_action,'RETURN_TO_ORIGIN');assert.equal(d.decision_id,rejectedDecisionSnapshot(args).decision_id);assert.equal(JSON.stringify(d).includes('fixture-conversation'),false);
});
test('owner modes expire and never invent applied discount capability',()=>{
 const config={enableIncidentDiscountTemplate:true,incidentDiscountRealEnabled:true,defaultStore:{incidentDiscountReturnAutomaticEnabled:true,incidentDiscountReturnRealEnabled:true}};
 const state={lastIncidentDiscountRecoveryAt:'2026-09-26T09:00:00Z'};
 const live=rejectedRuntimeStatus(config,state,Date.parse('2026-09-26T09:10:00Z'),{});assert.equal(live.stages.return,'LIVE');assert.equal(live.stages.discount,'UNKNOWN');assert.equal(live.policy.recovery_timeout_hours,48);
 assert.equal(rejectedRuntimeStatus(config,state,Date.parse('2026-09-26T10:00:00Z'),{}).stages.return,'UNKNOWN');
 assert.equal(rejectedRuntimeStatus(config,state,Date.parse('2026-09-26T09:10:00Z'),{RECIPIENT_REJECTED_AUTOMATION_LIVE:'false'}).stages.return,'OFF');
});
test('canonical timer waits 48h and prior return blocks a later recovery proposal',()=>{
 const args={incident:{orderId:'fixture-order',incidenceId:'fixture-issue',chatbyReadVerified:true},response:rejectedIntent(''),recovery:{verified:true,sentAt:'2026-09-20T10:00:00Z'},now:Date.parse('2026-09-22T09:59:59Z')};
 assert.equal(rejectedDecisionSnapshot(args).next_best_action,'WAIT_FOR_CUSTOMER');
 assert.equal(rejectedDecisionSnapshot({...args,now:Date.parse('2026-09-22T10:00:00Z')}).next_best_action,'RETURN_TO_ORIGIN');
 assert.equal(rejectedDecisionSnapshot({...args,incident:{...args.incident,incidentDiscountReturnStatus:'RETURN_ALREADY_REQUESTED_FOR_ORDER'},response:rejectedIntent('Acepto',{offerVerified:true})}).next_best_action,'HUMAN_REVIEW');
});
