import test from 'node:test';
import assert from 'node:assert/strict';
import {readRetryOutcome,deliveryFollowupReceipts,deliveryFollowupStatus} from './feedback.mjs';

const attemptedAt='2026-10-14T10:00:00Z';
const original={id:'101',order_id:'501',status:'RESOLVED',resolution_status:'RETRY'};
const later={id:'102',order_id:'501',status:'PENDING',is_active:true,resolution_status:null,created_at:'2026-10-15T12:00:00Z'};
function input(overrides={}){return {current:{order:{orderId:'501',status:'INCIDENCE'},issue:original},orderId:'501',issueId:'101',attemptedAt,incidents:[{orderId:'501',incidenceId:'101'},{orderId:'501',incidenceId:'102'}],readIssue:async()=>({issue:{raw:later}}),...overrides};}

test('new exact-order pending issue after retry is a reopened outcome',async()=>{
 const calls=[];
 const result=await readRetryOutcome(input({readIssue:async args=>{calls.push(args);return {issue:{raw:later}};}}));
 assert.deepEqual(result,{outcome:'INCIDENT_REOPENED',followupIssueId:'102'});
 assert.deepEqual(calls,[{orderId:'501',incidenceId:'102'}]);
});
test('cache cannot prove recurrence without a fresh provider read',async()=>{
 assert.equal((await readRetryOutcome(input({readIssue:async()=>({issue:{...later,status:'RESOLVED'}})}))).outcome,'AWAITING_CARRIER');
 await assert.rejects(()=>readRetryOutcome(input({readIssue:async()=>{throw Error('timeout');}})),/timeout/);
});
test('another order, inactive case or old issue does not become a recurrence',async()=>{
 for(const patch of [{is_active:false},{created_at:'2026-10-13T12:00:00Z',updated_at:'2026-10-16T12:00:00Z'},{resolution_status:'PICKUP_AT_AGENCY'},{created_at:'invalid'}]){
  assert.equal((await readRetryOutcome(input({readIssue:async()=>({issue:{...later,...patch}})}))).outcome,'AWAITING_CARRIER');
 }
 await assert.rejects(()=>readRetryOutcome(input({readIssue:async()=>({issue:{...later,order_id:'999'}})})),/IDENTITY_MISMATCH/);
});
test('duplicate discoveries are read once and unrelated orders are never fetched',async()=>{
 let calls=0;
 const incidents=[{orderId:'999',incidenceId:'444'},{orderId:'501',incidenceId:'102'},{orderId:'501',incidenceId:'102'}];
 await readRetryOutcome(input({incidents,readIssue:async()=>{calls++;return {issue:later};}}));
 assert.equal(calls,1);
});
test('delivered order remains delivered despite a cached incident',async()=>{
 const result=await readRetryOutcome(input({current:{order:{orderId:'501',status:'DELIVERED'},issue:original},readIssue:async()=>{throw Error('must not read');}}));
 assert.deepEqual(result,{outcome:'DELIVERED'});
});

test('verified solutions are followed alongside retries; receipt or issue resolution is not delivery',async()=>{
 const rows=['vps_retry_evidence','vps_delivery_reply','other'].map((owner,n)=>({order_id:'501',attempted_at:attemptedAt,raw:{owner,issueId:String(101+n)}}));
 assert.equal(deliveryFollowupReceipts([...rows,rows[0]]).length,2);
 assert.equal(deliveryFollowupReceipts([{...rows[1],raw:{...rows[1].raw,orderId:'999'}}]).length,0);
 const result=await readRetryOutcome(input({current:{order:{orderId:'501',status:'ERROR'},issue:{...original,resolution_status:'SOLUTION_PROVIDED'}},incidents:[]}));
 assert.deepEqual(result,{outcome:'AWAITING_CARRIER'});assert.deepEqual(deliveryFollowupStatus(result),{logisticsStatus:'AWAITING_NEW_DELIVERY',commerciallyClosed:false});
 assert.equal(deliveryFollowupStatus({outcome:'DELIVERED'}).commerciallyClosed,true);assert.equal(deliveryFollowupStatus({outcome:'INCIDENT_REOPENED'}).commerciallyClosed,false);
 await assert.rejects(()=>readRetryOutcome(input({current:{order:{orderId:'999',status:'DELIVERED'},issue:original}})),/IDENTITY_MISMATCH/);
});
