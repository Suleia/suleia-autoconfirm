import test from 'node:test';import assert from 'node:assert/strict';
import {absentContactGate,absentLiveFlags,absentLogisticsExecutionGate} from '../src/incident/absent-live-gates.mjs';
import {ABSENT_TEMPLATE_NAME,ABSENT_TEMPLATE_BODY,ABSENT_TEMPLATE_BUTTONS} from '../src/incident/absent-template.mjs';
import {ABSENT_POLICY_HASH} from '../src/incident/absent-evidence.mjs';
const now='2026-09-22T12:00:00Z';
const fixture=()=>({now,issue:{type:'RECIPIENT_ABSENT',raw_type:'RECIPIENT_ABSENT',canonical_issue_id:'i',canonical_order_id:'o',status:'PENDING',is_active:true,created_at:'2026-09-22T11:50:00Z',observed_at:now,delivery_attempt_number:1},order:{canonical_order_id:'o',identity_status:'EXACT',canonical_state:'IN_TRANSIT'},chatby:{verified:true,observed_at:now,issue_id:'i',order_id:'o',conversation_id:'c'},policy:{policy_id:'p',policy_snapshot_hash:ABSENT_POLICY_HASH},template:{name:ABSENT_TEMPLATE_NAME,id:'1552419',meta_id:'1123671516755556',language:'es_ES',category:'UTILITY',status:'APPROVED',body:ABSENT_TEMPLATE_BODY,buttons:ABSENT_TEMPLATE_BUTTONS.map(b=>({type:'QUICK_REPLY',text:b.text}))},flags:absentLiveFlags({AUSENTE_AUTOMATION_LIVE:true,AUSENTE_TEMPLATE_SENDS_ENABLED:true}),control:{circuit_breaker:'CLOSED',native_sender_disabled:true,ownership_scope:'RECIPIENT_ABSENT',ownership_evidence_id:'proof',rollback_snapshot_id:'backup',activation_at:'2026-09-22T11:00:00Z',callback_contract_verified:true,callback_contract_evidence_id:'callback-proof',atomic_claim_store_verified:true,notification_timer_transaction_verified:true,canary_slot_available:true}});
test('empty configuration never enables any absence write',()=>{assert.ok(Object.values(absentLiveFlags()).every(x=>x===false));assert.equal(absentContactGate().allowed,false);});
test('synthetic complete contact proof is independent of logistics unknowns',()=>{assert.equal(absentContactGate(fixture()).allowed,true);});
for(const [label,change] of [
 ['kill switch',x=>x.flags.AUSENTE_AUTOMATION_LIVE=false],['native owner',x=>x.control.native_sender_disabled=false],
 ['callback',x=>x.control.callback_contract_verified=false],['historical',x=>x.issue.created_at='2026-09-21T00:00:00Z'],
 ['other workflow',x=>x.issue.type='REFUSED_BY_RECIPIENT'],['old notice',x=>x.chatby.notification_observed=true],
 ['pending claim',x=>x.chatby.delivery_claim_exists=true],['wrong identity',x=>x.chatby.order_id='other'],
 ['template',x=>x.template.id='wrong'],['approval',x=>x.template.status='PENDING'],['stale',x=>x.chatby.observed_at='2026-09-21T00:00:00Z'],
 ['unknown attempt',x=>x.issue.delivery_attempt_number=null],['second',x=>x.issue.delivery_attempt_number=2],
 ['circuit',x=>x.control.circuit_breaker='TRIPPED'],['rollback',x=>x.control.rollback_snapshot_id=null],
 ['timer transaction',x=>x.control.notification_timer_transaction_verified=false],['canary',x=>x.control.canary_slot_available=false]
])test(`contact gate blocks ${label}`,()=>{const x=fixture();change(x);assert.equal(absentContactGate(x).allowed,false);});
for(const window of ['MORNING','AFTERNOON'])test(`${window} proposal never invents a provider payload`,()=>{
 const gate=absentLogisticsExecutionGate({shadow:{customer_intent:'RESCHEDULE_DELIVERY',requested_date:'2026-09-23',requested_time_window:window}});
 let writes=0;const writer=()=>writes++;if(gate.allowed)writer(gate.provider_payload);
 assert.equal(gate.proposal.requested_window,window);assert.equal(gate.provider_payload,null);assert.equal(writes,0);assert.equal(gate.execution_mode,'HUMAN_LOGISTICS_EXECUTION_REQUIRED');
 assert.equal(absentLogisticsExecutionGate({previousExecution:{id:'prior'}}).reason,'PREVIOUS_EXECUTION_REQUIRES_RECONCILIATION');
});
