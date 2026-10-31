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
test('compact support context keeps verified observations and question purposes without exposing transcripts',()=>{
 const r=fixture(),s=r.raw.conversationIntelligenceV3;
 Object.assign(s,{pending_customer_questions:[{type:'ASKS_USAGE',text:'PRIVATE'}],answered_customer_questions:['answered-id'],fact_ledger:[{fact_id:'answered-id',fact_type:'ASKS_PAYMENT'}],amount_due:24.99,policy:{liveVerifiedContext:true,paymentVerified:true,amountReadAt:s.updated_at,discountAppliedVerified:true},product_context:{verified:true,productName:'NIDA',units:2,verifiedAt:s.updated_at},pending_provider_response:true});
 const c=normalizeConversationV3Signal(r);assert.deepEqual(c.pending_question_types,['ASKS_USAGE']);assert.deepEqual(c.answered_question_types,['ASKS_PAYMENT']);assert.equal(c.observed_verified_amount_cents,2499);assert.equal(c.discount_state,'APPLIED_VERIFIED');assert.equal(c.product.units,2);assert.equal(c.reconciliation_state,'UNCERTAIN_SEND');assert.doesNotMatch(JSON.stringify(c),/PRIVATE/);
 s.policy.paymentVerified=false;assert.equal(normalizeConversationV3Signal(r).observed_verified_amount_cents,null);
});
test('retained context is exact, explicitly historical and keeps its original evidence timestamp',()=>{
 const row=fixture(),state=row.raw.conversationIntelligenceV3;delete row.raw.conversationIntelligenceV3;row.raw.conversationIntelligenceV3Retained={...state,source_state:'RETAINED_AFTER_SOURCE_GAP',source_failed_at:'2026-10-31T20:00:00Z',operational_action:'NONE',customer_reply_action:'NONE'};
 const c=normalizeConversationV3Signal(row);assert.equal(c.source_state,'RETAINED_AFTER_SOURCE_GAP');assert.equal(Date.parse(c.updated_at),Date.parse(state.updated_at));assert.equal(c.operational_action,'NONE');row.order_id='other';assert.equal(normalizeConversationV3Signal(row),null);
});
