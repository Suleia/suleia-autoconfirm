import test from 'node:test';import assert from 'node:assert/strict';
import {createNativeAbsentObserver,normalizeNativeAbsentHistory} from './recipient-absent-native-observer.mjs';
import {verifyNativeAbsentNotice} from './recipient-absent-native-verification.mjs';

test('API agent template with provider mid is independently verified without resending',()=>{
 const at='2026-09-29T18:00:00Z';
 const h=normalizeNativeAbsentHistory({complete:true,items:[{id:'synthetic-row',mid:'wamid.synthetic-only',type:'agent',
 ts:Date.parse(at)/1000,payload:{name:'dropea_ausente_v3'}}]},'synthetic-conversation');
 const r=verifyNativeAbsentNotice({conversation_id:'synthetic-conversation',claimed_at:at},h,new Date(at));
 assert.equal(r.verified,true);assert.equal(r.message_id,'synthetic-row');assert.equal(r.provider_message_id,'wamid.synthetic-only');
 assert.equal(Date.parse(r.timer.due_at)-Date.parse(r.timer.started_at),48*3600000);
});
test('provider notice normalizer retains actual message ID, time and contradictory template IDs',()=>{
 const a=normalizeNativeAbsentHistory({complete:true,items:[{mid:'test-id',type:'out',ts:1800000000,payload:{name:'dropea_ausente_v3'}}]},'test-conversation');
 assert.equal(a.messages[0].message_id,'test-id');assert.equal(a.messages[0].template_id,'1552419');assert.equal(a.messages[0].at,new Date(1800000000000).toISOString());
 const b=normalizeNativeAbsentHistory({complete:true,items:[{id:'test-id',type:'out',created_at:'2026-09-23T10:00:00Z',template_name:'dropea_ausente_v3',template_id:'wrong'}]},'test-conversation');
 assert.equal(b.messages[0].template_id,'wrong');
});
test('no persisted claims means no provider access or customer actions',async()=>{
 let fetches=0;const observer=createNativeAbsentObserver({pool:{query:async()=>({rows:[]})},token:'synthetic',fetchImpl:async()=>{fetches++;throw new Error('not expected');}});
 assert.deepEqual(await observer.run(),{observed:0});assert.equal(fetches,0);
});
