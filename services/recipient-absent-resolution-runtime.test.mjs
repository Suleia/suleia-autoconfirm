import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecipientAbsentResolutionRuntime} from './recipient-absent-resolution-runtime.mjs';
import {absentResolutionPreflight} from '../packages/platform-core/src/incident/absent-resolution.mjs';
import {fixture,now} from '../packages/platform-core/test/fixtures/absent-resolution.mjs';
test('runtime rereads exact provider issue/order after uncached exact conversation',async()=>{
 const x=fixture(),calls=[];
 const runtime=createRecipientAbsentResolutionRuntime({pool:{query:async()=>({rows:[{...x.issue,identity_status:'EXACT'}]})},projector:{},
  clients:[{store:{market:'ES',store_id:'store'},client:{request:async(name,params)=>{calls.push(name);assert.equal(params.id,name==='getIssue'?123:321);return {data:name==='getIssue'?{...x.issue,id:123,order_id:321}:{id:321,store_id:'store',status:'SHIPPING',sub_status:'DELIVERY_EXCEPTION',customer_phone:'+34600000001'}};}}}],
  writer:null,flags:{},privacyKey:'synthetic-test-key-'.repeat(3),now:()=>new Date(now),syncChatby:async opts=>{calls.push('chatby');assert.equal(opts.onlyCanonicalIssueId,'issue-a');assert.equal(opts.conversationCache,undefined);assert.equal(opts.subscriberCache,undefined);await opts.onAbsentConversation({events:x.events,chatby:x.chatby});return {ok:true,pagination_complete:true};}});
 const read=await runtime.readFresh('issue-a');assert.deepEqual(calls,['chatby','getIssue','getOrder']);assert.equal(absentResolutionPreflight(read,now).can_execute,true);
 assert.deepEqual(await runtime.run(),{status:'DISABLED',writes:0});
});
