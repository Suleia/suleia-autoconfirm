import test from 'node:test';
import assert from 'node:assert/strict';
import {syncChatbyReadOnly} from './readonly-sync.mjs';
const at=Date.parse('2026-09-17T15:00:00Z');
const issue=id=>({canonical_order_id:'safe-order',dropea_order_id:'SAFE-ORDER',canonical_issue_id:id,issue_type:'RECIPIENT_ABSENT',issue_created_at:'2026-09-17T12:00:00Z',issue_updated_at:'2026-09-17T12:00:00Z'});
const subscriberCache=()=>({items:[{user_ns:'safe-conversation',user_fields:[{name:'Dropea: Número',value:'SAFE-ORDER'}]}],fetchedAt:at,pageCount:1});
const response=data=>new Response(JSON.stringify(data),{status:200});
const projector=()=>({recordChatbyConversationEvent:async()=>({inserted:false}),upsertChatbyPrivateMessageDisplay:async()=>{},upsertChatbyConversationLink:async()=>{},markChatbyConversationAvailable:async()=>{}});
test('two exact issues charge one conversation budget and make one history request',async()=>{
 let calls=0;const links=[];
 const result=await syncChatbyReadOnly({pool:{query:async()=>({rows:[issue('safe-a'),issue('safe-b')]})},projector:{...projector(),upsertChatbyConversationLink:async row=>links.push(row)},token:'mock',hmacKey:'safe-mock-key-long-enough',now:()=>at,subscriberCache:subscriberCache(),maxConversations:1,minRequestIntervalMs:0,
 fetchImpl:async()=>{calls++;return response({data:[],meta:{last_page:1}});}});
 assert.equal(calls,1);assert.equal(result.conversations_read,1);assert.equal(result.budget_exhausted,0);assert.equal(links.filter(l=>l.conversation_status==='FOUND').length,2);
});
test('independent absence and general queries are mutually exclusive',async()=>{
 for(const [key,operator] of [['onlyRecipientAbsent','='],['excludeRecipientAbsent','<>']]){
 let sql='';await syncChatbyReadOnly({pool:{query:async s=>{sql=s;return {rows:[]};}},projector:projector(),token:'mock',hmacKey:'safe-mock-key-long-enough',subscriberCache:subscriberCache(),now:()=>at,[key]:true,fetchImpl:()=>assert.fail('no conversations eligible')});
 assert.ok(sql.includes(`coalesce(nullif(i.canonical_type,'UNKNOWN'),i.raw_type)${operator}'RECIPIENT_ABSENT'`));
 }
});
test('verified descending head overlap reuses older immutable history instead of reading page two',async()=>{
 const messages=Array.from({length:150},(_,i)=>({id:`safe-${i}`,type:'in',msg_type:'text',ts:at-i*1000,content:'synthetic'}));
 const cache=new Map([['safe-conversation',{fetchedAt:at-121000,messages:{complete:true,items:messages}}]]);
 const pages=[];const result=await syncChatbyReadOnly({pool:{query:async()=>({rows:[issue('safe-a')]})},projector:projector(),token:'mock',hmacKey:'safe-mock-key-long-enough',now:()=>at,subscriberCache:subscriberCache(),conversationCache:cache,conversationCacheTtlMs:120000,minRequestIntervalMs:0,
 fetchImpl:async url=>{pages.push(new URL(url).searchParams.get('page'));return response({data:messages.slice(0,100),meta:{last_page:2}});}});
 assert.deepEqual(pages,['1']);assert.equal(result.messages_reused_from_cache,50);assert.equal(result.messages_read,100);
});
test('an unavailable budget cannot erase an earlier exact read or pretend fresh silence',async()=>{
 let links=0;const cache=new Map([['safe-conversation',{fetchedAt:at-400000,messages:{complete:true,items:[]}}]]);
 const result=await syncChatbyReadOnly({pool:{query:async()=>({rows:[issue('safe-a')]})},projector:{...projector(),upsertChatbyConversationLink:async()=>{links++;}},token:'mock',hmacKey:'safe-mock-key-long-enough',now:()=>at,subscriberCache:subscriberCache(),conversationCache:cache,conversationCacheTtlMs:120000,maxConversations:0,fetchImpl:()=>assert.fail('read deferred')});
 assert.equal(links,0);assert.equal(result.budget_exhausted,1);assert.equal(cache.get('safe-conversation').fetchedAt,at-400000);
});
