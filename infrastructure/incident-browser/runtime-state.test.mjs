import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeReadiness,executionFailure,logisticsOutcome} from './runtime-state.mjs';
test('configured automation is not reported ready with stale reads, missing sessions or uncertain save',()=>{
 const now=Date.now(),input={now,control:{mode:'AUTO'},cycle:{completedAt:new Date(now).toISOString()},sites:{chatby:{session:'UI_PRESENT_REQUIRES_IDENTITY_VERIFICATION'},dropea:{session:'UI_PRESENT_REQUIRES_IDENTITY_VERIFICATION'}}};
 assert.equal(runtimeReadiness(input).executionEnabled,true);
 assert.equal(runtimeReadiness({...input,reconcile:true}).executionEnabled,false);
 assert.equal(runtimeReadiness({...input,sites:{}}).executionEnabled,false);
 assert.equal(runtimeReadiness({...input,cycle:{at:new Date(now-36*60000).toISOString()}}).readiness,'WAITING_FRESH_CYCLE');
 assert.equal(runtimeReadiness({...input,cycle:{...input.cycle,error:'FAILED'}}).readiness,'CYCLE_FAILED');
});
test('a screenshot error before saving does not become an uncertain provider mutation',()=>{
 assert.equal(executionFailure({error:Error('CAPTURE_FAILED')}).status,'FAILED_PRE_SAVE');
 assert.equal(executionFailure({saveAttempted:true,error:Error('timeout with provider detail')}).status,'RECONCILE');
 assert.equal(executionFailure({error:Error('private message')}).reason,'EXECUTION_INTERRUPTED');
});
test('successful retry is distinct from delivery, return and reopened incident',()=>{
 const attemptedAt='2026-10-13T19:00:00Z';
 assert.equal(logisticsOutcome({order:{status:'ERROR'},issue:{status:'RESOLVED',resolution_status:'RETRY'},attemptedAt}),'AWAITING_CARRIER');
 assert.equal(logisticsOutcome({order:{status:'DELIVERED'},attemptedAt}),'DELIVERED');
 assert.equal(logisticsOutcome({order:{status:'RETURNED'},attemptedAt}),'RETURNED_OR_RETURNING');
 assert.equal(logisticsOutcome({order:{status:'ERROR'},issue:{status:'PENDING',updated_at:'2026-10-14T10:00:00Z'},attemptedAt}),'INCIDENT_REOPENED');
});
