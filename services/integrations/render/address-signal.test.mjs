import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeAddressSignal} from './address-signal.mjs';
import {privateIncidentDisplay} from '../../../packages/suleia-operations-mcp/src/operations/private-display.mjs';
import {addressIncidentPresentation} from '../../../packages/platform-core/src/incident/address-presentation.mjs';
const key='fixture-private-key-at-least-thirty-two-characters';
test('address observation join is exact and independent of discount presence',()=>{
 const source=readFileSync(new URL('../../../packages/suleia-operations-mcp/src/operations/repository.mjs',import.meta.url),'utf8');
 const join=source.split('LEFT JOIN read_models.operations_address_owner_latest')[1].split('LEFT JOIN')[0];
 assert.match(join,/address_owner.canonical_order_id=p.canonical_order_id/);assert.equal(join.includes('discount.'),false);
});
const make=()=>({order_id:'22',incidence_id:'11',updated_at:new Date().toISOString(),raw:{orderId:'22',incidenceId:'11',incidentType:'address',addressWorkflow:{canonical_issue_id:'11',canonical_order_id:'22',state:'WAITING_DETAILS_MANUAL_REVIEW',action:'HUMAN_REVIEW',intent:'INCOMPLETE_ADDRESS',missing_fields:['postal_code','city'],initial_milestones:'SUPERSEDED_BY_CUSTOMER_RESPONSE',read_at:new Date().toISOString(),address:{street:'Calle Fixture',number:'25'},solution:'Private fixture',conversation_id:'private-conversation'}}});
test('address projection correlates exactly and encrypts private fields',()=>{
 const row=make(),s=normalizeAddressSignal(row,{hmacKey:key});
 assert.ok(s);assert.equal(JSON.stringify(s).includes('Calle Fixture'),false);assert.equal(JSON.stringify(s).includes('private-conversation'),false);
 const d=privateIncidentDisplay({private_address_ciphertext:s.private_address_ciphertext},key);
 assert.equal(d.address_details.provided.street,'Calle Fixture');assert.equal('private_address_ciphertext' in d,false);
 row.raw.addressWorkflow.canonical_issue_id='other';assert.equal(normalizeAddressSignal(row,{hmacKey:key}),null);
});
test('partial silence is explicitly manual and never rendered as execution',()=>{
 const s=normalizeAddressSignal(make(),{hmacKey:key});const result=addressIncidentPresentation({interpreted_type:'ADDRESS_INCORRECT',address_observation:s.observation});
 assert.equal(result.autonomy.status,'HUMAN_REVIEW');assert.match(result.next_best_action.reason,/plazos iniciales.*anulados/);assert.equal(result.execution.status,'NOT_STARTED');
});
test('newer customer evidence and stale address decisions prevent prepared display',()=>{
 for(const patch of [{latest_private_customer_message_at:new Date(Date.now()+1000).toISOString()},{}]){
  const d=make().raw.addressWorkflow;d.action='RETURN_TO_ORIGIN';if(!patch.latest_private_customer_message_at)d.read_at='2020-01-01T00:00:00Z';
  assert.equal(addressIncidentPresentation({interpreted_type:'ADDRESS_INCORRECT',address_observation:d,...patch}).next_best_action.action,'HUMAN_REVIEW');
 }
});
test('provider capability is displayed without exposing the private resolution body',()=>{
 const row=make();Object.assign(row.raw.addressWorkflow,{action:'CHANGE_ADDRESS',provider_plan:{action:'CHANGE_ADDRESS',allowed:true,body:{resolution_data:{address:{street:'Private Fixture Street'}}}}});
 const s=normalizeAddressSignal(row,{hmacKey:key});assert.equal(JSON.stringify(s).includes('Private Fixture Street'),false);
 assert.deepEqual(s.observation.provider_plan,{action:'CHANGE_ADDRESS',allowed:true,reason:null});
 const shown=addressIncidentPresentation({interpreted_type:'ADDRESS_INCORRECT',address_observation:s.observation});assert.match(shown.next_best_action.label,/Cambiar dirección/);
});
test('attempt rejected by GLS becomes review, never not-started or a prepared return',()=>{
 const row=make();Object.assign(row.raw.addressWorkflow,{action:'RETURN_TO_ORIGIN',execution:{status:'MANUAL_RECONCILIATION_REQUIRED',error:'DROPEA_V2_ISSUE_ACTION_HTTP_400',provider_error_code:'GLS_INCIDENCE_ALREADY_SOLVED',verified:false,attemptedAt:new Date().toISOString()}});
 const s=normalizeAddressSignal(row,{hmacKey:key});const shown=addressIncidentPresentation({interpreted_type:'ADDRESS_INCORRECT',address_observation:s.observation});
 assert.equal(shown.execution.status,'UNKNOWN');assert.equal(shown.next_best_action.action,'HUMAN_REVIEW');assert.match(shown.next_best_action.reason,/GLS rechaza/);assert.ok(shown.execution.requested_at);
});
