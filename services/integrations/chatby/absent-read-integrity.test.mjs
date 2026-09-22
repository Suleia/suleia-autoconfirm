import test from 'node:test';
import assert from 'node:assert/strict';
import {syncChatbyReadOnly} from './readonly-sync.mjs';
const at=Date.parse('2026-09-17T15:00:00Z');
const issue=id=>({canonical_order_id:'safe-order',dropea_order_id:'SAFE-ORDER',canonical_issue_id:id,issue_type:'RECIPIENT_ABSENT',issue_created_at:'2026-09-17T12:00:00Z',issue_updated_at:'2026-09-17T12:00:00Z'});
const subscriberCache=()=>({items:[{user_ns:'safe-conversation',user_fields:[{name:'Dropea: Número',value:'SAFE-ORDER'}]}],fetchedAt:at,pageCount:1});
const response=data=>new Response(JSON.stringify(data),{status:200});
const projector=()=>({recordChatbyConversationEvent:async()=>({inserted:false}),upsertChatbyPrivateMessageDisplay:async()=>{},upsertChatbyConversationLink:async()=>{},markChatbyConversationAvailable:async()=>{}});
test('resolution callback exposes exact fresh evidence only for target issue, with provider IDs',async()=>{
 const contexts=[];const messages=[{id:'native-notice',type:'out',msg_type:'template',created_at:'2026-09-17T13:00:00Z',template_name:'es_ES dropea_ausente_v3'},
  {id:'real-response',type:'in',msg_type:'button',created_at:'2026-09-17T14:00:00Z',payload:{payload:'ABSENT_TOMORROW_PM',title:'Mañana por la tarde'}}];
 await syncChatbyReadOnly({pool:{query:async()=>({rows:[issue('target'),issue('other')]})},projector:projector(),token:'mock',hmacKey:'safe-mock-key-long-enough',now:()=>at,subscriberCache:subscriberCache(),onlyRecipientAbsent:true,onlyCanonicalIssueId:'target',onAbsentConversation:v=>contexts.push(v),minRequestIntervalMs:0,fetchImpl:async()=>response({data:messages})});
 assert.equal(contexts.length,1);assert.equal(contexts[0].chatby.history_complete,true);assert.ok(contexts[0].chatby.notification_message_id);
 assert.equal(contexts[0].events.every(e=>e.canonical_issue_id==='target' && e.provider_message_id_verified),true);
 assert.equal(contexts[0].events.find(e=>e.direction==='INBOUND').button_verified,true);
});

test('concurrent exclusive phases coalesce a complete catalogue traversal without duplicate GETs',async()=>{
 let calls=0;const cache={};const input={pool:{query:async()=>({rows:[]})},projector:projector(),token:'mock',hmacKey:'safe-mock-key-long-enough',subscriberCache:cache,minRequestIntervalMs:0,fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return response({data:[],meta:{last_page:1}});}};
 await Promise.all([syncChatbyReadOnly({...input,onlyRecipientAbsent:true}),syncChatbyReadOnly({...input,excludeRecipientAbsent:true})]);assert.equal(calls,1);assert.equal(cache.inFlight,undefined);
});

test('v3 read lane binds notification and stable button ID; duplicate provider event remains idempotent and initial confirmation excluded',async()=>{
 const events=[],links=[],privateMessages=[],known=new Set();
 const button={id:'safe-button',type:'in',msg_type:'button',created_at:'2026-09-17T14:00:00Z',payload:{payload:'ABSENT_OTHER_DAY',title:'📅 Elegir otro día'}};
 const messages=[{id:'safe-old-template',type:'out',msg_type:'template',created_at:'2026-09-17T11:00:00Z',template_name:'es_ES dropea_pedido_nuevo_v1'},
  {id:'safe-checkout-confirmation',type:'in',msg_type:'button',created_at:'2026-09-17T12:05:00Z',content:'CONFIRMAR MI PEDIDO'},
  {id:'safe-v3-template',type:'out',msg_type:'template',created_at:'2026-09-17T13:00:00Z',template_name:'es_ES dropea_ausente_v3'},button,structuredClone(button)];
 const result=await syncChatbyReadOnly({pool:{query:async()=>({rows:[issue('safe-issue')]})},projector:{...projector(),recordChatbyConversationEvent:async e=>{events.push(e);const inserted=!known.has(e.source_event_id);known.add(e.source_event_id);return {inserted};},upsertChatbyPrivateMessageDisplay:async e=>privateMessages.push(e),upsertChatbyConversationLink:async e=>links.push(e)},token:'mock',hmacKey:'safe-mock-key-long-enough',now:()=>at,subscriberCache:subscriberCache(),onlyRecipientAbsent:true,minRequestIntervalMs:0,fetchImpl:async()=>response({data:messages,meta:{last_page:1}})});
 const replies=events.filter(e=>e.direction==='INBOUND');assert.equal(replies.length,1);assert.equal(new Set(events.map(e=>e.source_event_id)).size,events.length);assert.equal(replies[0].button_payload,'ABSENT_OTHER_DAY');assert.equal(replies[0].canonical_order_id,'safe-order');
 assert.equal(links[0].notification_observed_at,'2026-09-17T13:00:00.000Z');assert.equal(links[0].customer_replied,true);assert.equal(privateMessages.find(e=>e.incident_relevance==='ORDER_LIFECYCLE_ONLY')?.context_template_slug,'dropea_pedido_nuevo_v1');
 assert.equal(result.actions_executed,0);assert.equal(result.production_writes,0);assert.equal(result.messages_sent,0);assert.deepEqual(result.external_methods,['GET']);
});

test('AUSENTE 429 makes one GET and retains the full provider cooldown, never fake freshness',async()=>{
 let calls=0;let writes=0;const cache={};const started=Date.now();
 await assert.rejects(syncChatbyReadOnly({pool:{query:async()=>({rows:[]})},projector:{...projector(),upsertChatbyConversationLink:async()=>{writes++;}},token:'mock',hmacKey:'safe-mock-key-long-enough',onlyRecipientAbsent:true,subscriberCache:cache,minRequestIntervalMs:0,fetchImpl:async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'386'}});}}),e=>e.code==='CHATBY_SUBSCRIBERS_HTTP_429' && e.retryNotBefore>=started+386000);
 assert.equal(calls,1);assert.equal(writes,0);assert.equal(cache.fetchedAt,undefined);assert.equal(cache.inFlight,undefined);
});

test('a cached general catalogue is not a provider traversal that can renew a shorter absence cache',async()=>{
 let calls=0;const cache=subscriberCache();cache.fetchedAt=at-300000;
 const input={pool:{query:async()=>({rows:[]})},projector:projector(),token:'mock',hmacKey:'safe-mock-key-long-enough',subscriberCache:cache,now:()=>at,minRequestIntervalMs:0,fetchImpl:async()=>{calls++;return response({data:[],meta:{last_page:1}});}};
 await Promise.all([syncChatbyReadOnly({...input,excludeRecipientAbsent:true,subscriberCacheTtlMs:900000}),syncChatbyReadOnly({...input,onlyRecipientAbsent:true,subscriberCacheTtlMs:240000})]);assert.equal(calls,1);assert.equal(cache.fetchedAt,at);
});
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
