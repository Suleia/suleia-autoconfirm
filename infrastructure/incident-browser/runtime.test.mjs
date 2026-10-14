import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedProviderRetry,retryBatchCanContinue} from './runtime.mjs';
test('AUTO advances after verified retries but never after uncertain writes or budget exhaustion',()=>{
 const input={mode:'AUTO',elapsedMs:1000,results:[{status:'VERIFIED',saveAttempted:true}]};
 assert.equal(retryBatchCanContinue(input),true);
 assert.equal(retryBatchCanContinue({...input,mode:'AUTO_CANARY'}),false);
 assert.equal(retryBatchCanContinue({...input,elapsedMs:21*60000}),false);
 assert.equal(retryBatchCanContinue({...input,results:[{status:'RECONCILE',saveAttempted:true}]}),false);
 assert.equal(retryBatchCanContinue({...input,results:[{status:'FAILED_PRE_SAVE',saveAttempted:false}]}),true);
 assert.equal(retryBatchCanContinue({...input,mode:'OBSERVE_ONLY'}),false);
});
test('provider verification binds identity, current result, date, window and fresh timestamp',()=>{
 const p={orderId:'900001',issueId:'800001',date:'2026-10-15',time_window:'morning'},at='2026-10-13T19:00:00Z';
 const raw={id:800001,order_id:900001,status:'RESOLVED',resolution_status:'RETRY',resolution_data:{date:p.date,time_window:p.time_window},resolution_changed_at:at};
 assert.equal(verifiedProviderRetry(raw,p,at),true);
 for(const delta of [{id:800002},{order_id:900002},{status:'PENDING'},{resolution_status:'RETURN_REQUESTED'},{resolution_changed_at:'2026-10-12T00:00:00Z'},{resolution_data:{date:p.date,time_window:'afternoon'}},{resolution_data:{date:'2026-10-16',time_window:'morning'}}])assert.equal(verifiedProviderRetry({...raw,...delta},p,at),false);
});
