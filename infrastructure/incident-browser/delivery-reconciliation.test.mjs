import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileDeliveryReply} from './delivery-reply-runtime.mjs';
const pending={plan:{orderId:'900001',issueId:'800001',note:'Original note'},attemptedAt:'2026-10-23T12:00:00Z'};
test('interrupted delivery reconciles by reads and clears only after verified durable completion',async()=>{
 const calls=[];const r=await reconcileDeliveryReply(pending,{read:async p=>{assert.equal(p,pending.plan);calls.push('read');return {};},
 verify:async(p,at)=>{assert.equal(at,pending.attemptedAt);calls.push('verify');return true;},finish:async s=>calls.push(s),clear:async()=>calls.push('clear')});
 assert.equal(r.verified,true);assert.deepEqual(calls,['read','verify','verified','clear']);
});
test('unobserved note and provider failures retain journal and never replay a write',async()=>{
 for(const failure of [false,'PERSISTED_DETAIL_READ_FAILED','PERSISTED_DETAIL_DIALOG_NOT_OBSERVED','PERSISTED_NOTE_NOT_OBSERVED','private error content']){
  let mutations=0;const r=await reconcileDeliveryReply(pending,{read:async()=>({}),verify:async()=>{if(failure)throw Error(failure);return false;},finish:async()=>mutations++,clear:async()=>mutations++});
  assert.equal(r.verified,false);assert.equal(mutations,0);assert.notEqual(r.reason,'private error content');
 }
});
test('failed persistence never clears an uncertain journal',async()=>{
 let cleared=false;const r=await reconcileDeliveryReply(pending,{read:async()=>({}),verify:async()=>true,finish:async()=>{throw Error('store');},clear:async()=>{cleared=true;}});
 assert.equal(r.verified,false);assert.equal(cleared,false);
});
