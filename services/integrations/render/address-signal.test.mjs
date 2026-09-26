import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAddressSignal} from './address-signal.mjs';
import {privateIncidentDisplay} from '../../../packages/suleia-operations-mcp/src/operations/private-display.mjs';
import {addressIncidentPresentation} from '../../../packages/platform-core/src/incident/address-presentation.mjs';
const key='fixture-private-key-at-least-thirty-two-characters';
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
