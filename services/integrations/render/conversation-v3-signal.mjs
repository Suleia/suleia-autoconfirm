import {normalizeCustomerCareSignal} from './customer-care-signal.mjs';
const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(v)?v:null;
const codes=v=>(Array.isArray(v)?v:[]).slice(0,40).map(code).filter(Boolean);
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const mid=v=>typeof v==='string'&&/^wamid\.[A-Za-z0-9_+=.\/-]{1,240}$/.test(v)?v:null;
export function normalizeConversationV3Signal(row){
  const state=row.raw?.conversationIntelligenceV3;
  if(!state||state.version!=='CONVERSATION_V3')return null;
  const base=normalizeCustomerCareSignal({...row,raw:{customerCare:state}});if(!base)return null;
  const facts=Object.values(state.current_facts||{}),policy=state.policy||{},product=state.product_context;
  const answered=new Set(state.answered_customer_questions||[]);
  const last=(state.timeline||[]).filter(t=>t.kind==='INFORMATION_RESPONSE'&&t.provider_message_id).at(-1);
  const amount=policy.liveVerifiedContext===true&&policy.paymentVerified===true&&Number.isFinite(state.amount_due)&&state.amount_due>=0?Math.round(state.amount_due*100):null;
  return {...base,version:'CONVERSATION_V3',operational_action:code(state.operational_action),customer_reply_action:code(state.customer_reply_action),
    pending_question_types:codes((state.pending_customer_questions||[]).map(q=>q.type)),
    answered_question_types:codes((state.fact_ledger||[]).filter(f=>answered.has(f.fact_id)).map(f=>f.fact_type)),
    verified_fact_types:codes(facts.filter(f=>f.confidence>=.9&&['PROVIDER_VERIFIED','SYSTEM_CONTROLLED'].includes(f.authority)).map(f=>f.fact_type)),
    ambiguous_fact_types:codes(facts.filter(f=>f.confidence<.9).map(f=>f.fact_type)),
    unresolved:codes(state.unresolved_interpretation),
    product:product?.verified===true&&['NIDA','CollaGum','Seoul 1988'].includes(product.productName)?{name:product.productName,units:Number.isSafeInteger(product.units)&&product.units>0?product.units:null,source_verified_at:at(product.verifiedAt),missing_topics:codes(product.missingTopics)}:null,
    observed_verified_amount_cents:amount,amount_verified_at:amount!==null?at(policy.amountReadAt):null,
    discount_state:policy.discountAppliedVerified===true?'APPLIED_VERIFIED':state.discount_response==='ACCEPTED'?'ACCEPTED_AWAITING_VERIFICATION':code(state.discount_response),
    last_contextual_outbound:last?{at:at(last.at),type:code(last.response_type),sender:code(last.source),wamid:mid(last.provider_message_id),readback_verified:last.readback_verified===true}:null,
    blocked_duplicate_findings:(state.findings||[]).filter(f=>f.code==='REPEATED_CLARIFICATION').length,
    interpretation_quality:state.unresolved_interpretation?.length?'REVIEW_REQUIRED':policy.liveVerifiedContext===true?'BOUND_PROVIDER_VERIFIED':'OBSERVATIONAL',
    reconciliation_state:state.pending_provider_response?'UNCERTAIN_SEND':last?.readback_verified===true?'READBACK_VERIFIED':'NO_VERIFIED_CONTEXTUAL_RECEIPT',
    known_slots:Object.entries(state.current_facts||{}).filter(([,f])=>f?.confidence>=.9&&f.status==='CURRENT').slice(0,40).map(([type])=>code(type)).filter(Boolean),
    missing_slots:(state.missing_information||[]).slice(0,20).map(code).filter(Boolean),
    superseded_fact_types:[...new Set((state.fact_ledger||[]).filter(f=>['SUPERSEDED','EXPIRED','RETRACTED'].includes(f.status)).map(f=>code(f.fact_type)).filter(Boolean))].slice(0,40),
    confidence:Object.fromEntries(Object.entries(state.fact_confidence||{}).filter(([k,v])=>code(k)&&typeof v==='number'&&v>=0&&v<=1).slice(0,40)),
    decision_reason_codes:(state.decision_reason_codes||[]).slice(0,20).map(code).filter(Boolean),
    shadow_comparison:code(state.shadow_comparison),
    timeline:(state.timeline||[]).slice(-8).map(t=>({kind:code(t.kind),at:typeof t.at==='string'&&Number.isFinite(Date.parse(t.at))?new Date(t.at).toISOString():null,fact_type:code(t.fact_type),authority:code(t.authority),action:code(t.action),reason:code(t.reason)}))};
}
