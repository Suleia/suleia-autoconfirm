import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConversationV3Signal} from './conversation-v3-signal.mjs';
const fixture=()=>({order_id:'1',incidence_id:'2',raw:{conversationIntelligenceV3:{version:'CONVERSATION_V3',dropea_order_id:'1',active_issue_id:'2',updated_at:'2026-10-30T12:00:00Z',mode:'SHADOW',current_facts:{WANTS_ORDER:{value_json:true}},fact_ledger:[{fact_type:'ADDRESS',status:'SUPERSEDED',value_json:'PRIVATE'}],fact_confidence:{WANTS_ORDER:.99},operational_action:'RETRY_DELIVERY',customer_reply_action:'NONE',timeline:[{kind:'FACT_EXTRACTED',fact_type:'WANTS_ORDER',authority:'CUSTOMER_DERIVED',at:'2026-10-30T12:00:00Z',text:'PRIVATE'}]}}});
test('V3 projection exports typed facts/confidence/actions without values or source transcripts',()=>{
 const fixtureBase=fixture; // Synthetic projection only; no provider or private history.
 const row=fixtureBase();row.raw.conversationIntelligenceV3.current_facts.WANTS_ORDER={value_json:true,confidence:.99,status:'CURRENT'};
 const c=normalizeConversationV3Signal(row);assert.deepEqual(c.known_slots,['WANTS_ORDER']);assert.deepEqual(c.superseded_fact_types,['ADDRESS']);assert.equal(c.confidence.WANTS_ORDER,.99);assert.equal(c.operational_action,'RETRY_DELIVERY');assert.doesNotMatch(JSON.stringify(c),/PRIVATE/);
});

test('low-confidence or expired facts are not displayed as known',()=>{
 const row=fixture();row.raw.conversationIntelligenceV3.current_facts={DELIVERY_DATE:{confidence:.55,status:'CURRENT'},DELIVERY_WINDOW:{confidence:.99,status:'EXPIRED'}};
 assert.deepEqual(normalizeConversationV3Signal(row).known_slots,[]);
});
test('V3 context must retain exact binding, date and safe scalar types',()=>{
 for(const mutate of [c=>c.dropea_order_id='3',c=>c.active_issue_id='4',c=>c.updated_at=null]){const r=fixture();mutate(r.raw.conversationIntelligenceV3);assert.equal(normalizeConversationV3Signal(r),null);}
 const r=fixture();r.raw.conversationIntelligenceV3.fact_confidence={WANTS_ORDER:NaN,BAD:2,'<script>':1};assert.deepEqual(normalizeConversationV3Signal(r).confidence,{});
});
