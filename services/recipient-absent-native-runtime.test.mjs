import test from 'node:test';import assert from 'node:assert/strict';
import {createNativeAbsentFreshReader} from './recipient-absent-native-runtime.mjs';
const row={canonical_issue_id:'issue',canonical_order_id:'order',dropea_issue_id:'1'};
const fresh=()=>({issue:{...row,type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,delivery_attempt_number:1,created_at:'2026-09-23T10:00:00Z'},
 order:{canonical_order_id:'order',identity_status:'EXACT'},chatby:{conversation_id:'subscriber',verified:true,history_complete:true,notification_count:0},
 decision_currentness:'CURRENT',return_in_progress:false});
test('native caller cannot claim another order or subscriber and cannot provide eligibility flags',async()=>{
 let context=fresh();const reader=createNativeAbsentFreshReader({pool:{query:async()=>({rows:[row]})},resolutionRuntime:{readFresh:async()=>context}});
 const good=await reader({issue_id:'1',order_id:'2',user_ns:'subscriber',previous_notification_count:0});
 assert.equal(good.absence_classification,'FIRST_ABSENCE');
 await assert.rejects(reader({user_ns:'other'}),/EXACT_CONVERSATION/);
 context={...fresh(),order:{canonical_order_id:'other',identity_status:'EXACT'}};
 await assert.rejects(reader({user_ns:'subscriber'}),/EXACT_CONVERSATION/);
 context=fresh();context.chatby.notification_count=1;
 assert.equal((await reader({user_ns:'subscriber',previous_notification_count:0})).previous_notification_count,1);
});

test('native order-only trigger requires a single current active issue and revalidates its identity',async()=>{
 let rows=[row],context=fresh(),lastQuery,lastParams;
 const reader=createNativeAbsentFreshReader({pool:{query:async(sql,params)=>{lastQuery=sql;lastParams=params;return {rows};}},resolutionRuntime:{readFresh:async()=>context}});
 assert.equal((await reader({order_id:'2',user_ns:'subscriber',issue_id:''})).canonical_issue_id,'issue');
 assert.deepEqual(lastParams,['2',null]);
 assert.match(lastQuery,/c.current=true/);assert.match(lastQuery,/i.is_active=true/);assert.match(lastQuery,/i.status='PENDING'/);
 await reader({issue_id:'1',order_id:'2',user_ns:'subscriber'});assert.deepEqual(lastParams,['2','1']);
 rows=[row,{...row,canonical_issue_id:'another'}];await assert.rejects(reader({order_id:'2',user_ns:'subscriber'}),/EXACT_ISSUE/);
 rows=[];await assert.rejects(reader({order_id:'2',user_ns:'subscriber'}),/EXACT_ISSUE/);
 rows=[row];context.issue.dropea_issue_id='other';await assert.rejects(reader({order_id:'2',user_ns:'subscriber'}),/EXACT_ISSUE/);
});
