import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticReplyCapability,executeAutomaticReply} from './incident-reply-capability.mjs';
import {parseCustomerAddress,addressResponseDecision} from './address-response-policy.mjs';
import {governedAddressIssue} from './address-capability-policy.mjs';
import {resolutionCandidate} from './incident-resolution-plan.mjs';
const sha='a'.repeat(40);
const candidate={action:'PICKUP_AT_AGENCY',providerPlan:{allowed:true},twin:{workflow:'ABSENT',incident_id:'test-issue',order_id:'test-order',resolution_plan:{plan_id:'test-plan'}}};
const env={INCIDENT_E2E_ABSENT_PICKUP_AT_AGENCY_MODE:'AUTO_CANARY',INCIDENT_E2E_ABSENT_PICKUP_AT_AGENCY_BREAKER:'CLOSED',INCIDENT_REPLY_REGRESSION_GATE_REVISION:sha,RENDER_GIT_COMMIT:sha};
function memory(){let row=null;return {get:async()=>structuredClone(row),initialize:async(key,value)=>row={key,value},cas:async(old,value)=>old.value.revision===row.value.revision?(row={...row,value}):null};}
test('automatic capability is opt-in, scope-limited and release-gated',async()=>{
 assert.equal(automaticReplyCapability(candidate,{}),false);
 assert.ok(!automaticReplyCapability({...candidate,action:'APPLY_DISCOUNT'},env));
 const r=await executeAutomaticReply({},candidate,{env:{...env,RENDER_GIT_COMMIT:'b'.repeat(40)}},{state:memory(),execute:()=>assert.fail('write')});assert.equal(r.reason,'CAPABILITY_RELEASE_GATE');
});
test('verified first real action promotes its capability and subsequent execution uses LIVE',async()=>{
 const state=memory(),modes=[];const execute=async(i,c,d)=>{modes.push(d.env.INCIDENT_E2E_ABSENT_PICKUP_AT_AGENCY_MODE);return {status:'VERIFIED',verified:true,verifiedAt:new Date().toISOString()};};
 assert.equal((await executeAutomaticReply({},candidate,{env},{state,execute})).promoted,true);
 assert.equal((await executeAutomaticReply({},candidate,{env},{state,execute})).promoted,false);
 assert.deepEqual(modes,['CANARY','LIVE']);
});
test('unknown action blocks further cases and does not promote',async()=>{
 const state=memory();await executeAutomaticReply({},candidate,{env},{state,execute:async()=>({status:'UNKNOWN',verified:false})});
 const r=await executeAutomaticReply({},candidate,{env},{state,execute:()=>assert.fail('duplicate')});assert.equal(r.reason,'CAPABILITY_RESERVED_OR_UNCERTAIN');
});
test('concurrent runners reserve only one canary',async()=>{
 const state=memory();await state.initialize('key',{revision:'initial',phase:'WAITING_ELIGIBLE_CASE'});let calls=0;
 await Promise.all([1,2].map(()=>executeAutomaticReply({},candidate,{env},{state,execute:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {status:'VERIFIED',verified:true};}})));
 assert.equal(calls,1);
});
test('late evidence abort releases capability without recording a promotion',async()=>{
 const state=memory();await executeAutomaticReply({},candidate,{env},{state,execute:async()=>({status:'PREPARED',verified:false,reason:'CURRENT_EVIDENCE_CHANGED'})});
 assert.equal((await state.get()).value.phase,'WAITING_ELIGIBLE_CASE');assert.equal((await state.get()).value.promotion,undefined);
});
test('pending data requires exact carrier mapping',()=>{
 const i={type:'PENDING_DATA',carrier:'GLS',market:'ES',initial_carrier_code:'-30',initial_carrier_substatus_code:'12',initial_carrier_description:'FALTAN DATOS'};
 assert.equal(governedAddressIssue(i),true);assert.equal(governedAddressIssue({...i,initial_carrier_substatus_code:'13'}),false);assert.equal(governedAddressIssue({...i,type:'OTHER'}),false);
});
test('bare same-order street preserves number floor door and separates country from city',()=>{
 const text='Prueba del Parque 104 3-2. 28001 Madrid España.';
 const parsed=parseCustomerAddress(text,null,{originalStreet:'Prueba del Parque'});
 assert.equal(parsed.kind,'VALID_ADDRESS');assert.equal(parsed.street,'Prueba del Parque');assert.equal(parsed.number,'104');assert.equal(parsed.floor,'3');assert.equal(parsed.door,'2');assert.equal(parsed.city,'Madrid');
 assert.equal(parseCustomerAddress(text,null,{originalStreet:'Otra dirección'}).kind,'INCOMPLETE_ADDRESS');
});
const now=Date.parse('2026-10-08T17:00:00Z');
function input(text,type='address'){
 return {now,incident:{orderId:'101',incidenceId:'201',incidentType:type,incidenceDate:'2026-10-08T08:00:00Z',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',chatbyUserNs:'fixture'},order:{orderId:'101',createdAt:'2026-10-07T08:00:00Z',status:'ERROR',customerPhone:'600000000',raw:{shipping_address:{address_line_1:'Prueba del Parque',postal_code:'28001',city:'Madrid'}}},issue:{id:'201',order_id:'101',type:'PENDING_DATA',status:'PENDING',is_active:true,updated_at:'2026-10-08T08:00:00Z',allowed_resolution_options:['PROVIDE_SOLUTION','RETRY']},messages:[{type:'agent',ts:Date.parse('2026-10-08T08:01:00Z')/1000,mid:'wamid.test',payload:{name:type==='address'?'dropea_incidencia_direccion_v1':'dropea_ausente_v3'}},{type:'in',id:'response',ts:Date.parse('2026-10-08T09:00:00Z')/1000,payload:{text}}]};
}
test('missing-data solution retains supplied address and mandatory call instruction',()=>{
 const c=resolutionCandidate(input('Prueba del Parque 104 3-2. 28001 Madrid España.'));
 assert.equal(c.action,'PROVIDE_SOLUTION');assert.equal(c.twin.human_review_reason,null);assert.match(c.data.note,/piso 3, puerta 2/);assert.match(c.data.note,/600000000 antes de la entrega/);
});
test('later unresolved instruction blocks previous valid address',()=>{
 const i=input('Calle Prueba 7, 28001 Madrid');i.messages.push({type:'in',id:'later',ts:Date.parse('2026-10-08T10:00:00Z')/1000,payload:{text:'Espera, necesito aclararlo'}});
 assert.equal(addressResponseDecision(i).eligible,false);
});
test('confirmed original address without number cannot produce a solution',()=>{
 assert.notEqual(resolutionCandidate(input('Confirmo la dirección correcta')).action,'PROVIDE_SOLUTION');
 assert.ok(resolutionCandidate(input('La dirección no es correcta')).twin.human_review_reason);
});
test('same-day morning request cannot be executed in the evening',()=>{
 const i=input('2026-10-08 por la mañana','absent');assert.equal(resolutionCandidate(i).twin.human_review_reason,'REQUESTED_DELIVERY_WINDOW_EXPIRED');
});
