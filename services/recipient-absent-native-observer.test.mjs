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
test('failed history advances attempt fairness without marking evidence verified or retrying',async()=>{
 const queries=[];let reads=0;
 const pool={query:async(sql,args)=>{
  queries.push({sql,args});
  if(sql.includes('SELECT claim_id'))return {rows:[{claim_id:'synthetic-claim'}]};
  if(sql.includes('SELECT *'))return {rows:[{conversation_id:'synthetic-conversation'}]};
  return {rows:[]};
 }};
 const observer=createNativeAbsentObserver({pool,token:'synthetic',now:()=>new Date('2026-10-20T10:00:00Z'),
  fetchImpl:async()=>{reads++;return new Response('',{status:404});}});
 assert.deepEqual(await observer.run(),{observed:0,failed:true,error_code:'CHATBY_MESSAGES_HTTP_404'});
 assert.deepEqual(await observer.run(),{observed:0,deferred:true});
 assert.equal(reads,1);
 assert.match(queries[0].sql,/greatest[\s\S]*last_read_failed_at/);
 const update=queries.find(q=>q.sql.startsWith('UPDATE'));
 assert.deepEqual(JSON.parse(update.args[1]),{last_read_failed_at:'2026-10-20T10:00:00.000Z',last_read_error:'CHATBY_MESSAGES_HTTP_404'});
 assert.doesNotMatch(update.sql,/SET status|last_observed_at|DELETE|INSERT/);
});
test('unexpected provider exception cannot leak message or credentials into diagnostics',async()=>{
 const saved=[];
 const pool={query:async(sql,args)=>{
  if(sql.includes('SELECT claim_id'))return {rows:[{claim_id:'test'}]};
  if(sql.includes('SELECT *'))return {rows:[{conversation_id:'test'}]};
  saved.push(args);return {rows:[]};
 }};
 const observer=createNativeAbsentObserver({pool,token:'synthetic',
 fetchImpl:async()=>{throw Object.assign(new Error('private-provider-response'),{code:'private-secret'});}});
 const result=await observer.run();
 assert.equal(result.error_code,'OBSERVER_READ_FAILED');
 assert.doesNotMatch(JSON.stringify({result,saved}),/private-provider|private-secret/);
});
