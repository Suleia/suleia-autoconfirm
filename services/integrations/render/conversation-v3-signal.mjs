import {normalizeCustomerCareSignal} from './customer-care-signal.mjs';
const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(v)?v:null;
export function normalizeConversationV3Signal(row){
  const state=row.raw?.conversationIntelligenceV3;
  if(!state||state.version!=='CONVERSATION_V3')return null;
  const base=normalizeCustomerCareSignal({...row,raw:{customerCare:state}});if(!base)return null;
  return {...base,version:'CONVERSATION_V3',operational_action:code(state.operational_action),customer_reply_action:code(state.customer_reply_action),
    known_slots:Object.entries(state.current_facts||{}).filter(([,f])=>f?.confidence>=.9&&f.status==='CURRENT').slice(0,40).map(([type])=>code(type)).filter(Boolean),
    missing_slots:(state.missing_information||[]).slice(0,20).map(code).filter(Boolean),
    superseded_fact_types:[...new Set((state.fact_ledger||[]).filter(f=>['SUPERSEDED','EXPIRED','RETRACTED'].includes(f.status)).map(f=>code(f.fact_type)).filter(Boolean))].slice(0,40),
    confidence:Object.fromEntries(Object.entries(state.fact_confidence||{}).filter(([k,v])=>code(k)&&typeof v==='number'&&v>=0&&v<=1).slice(0,40)),
    decision_reason_codes:(state.decision_reason_codes||[]).slice(0,20).map(code).filter(Boolean),
    shadow_comparison:code(state.shadow_comparison),
    timeline:(state.timeline||[]).slice(-8).map(t=>({kind:code(t.kind),at:typeof t.at==='string'&&Number.isFinite(Date.parse(t.at))?new Date(t.at).toISOString():null,fact_type:code(t.fact_type),authority:code(t.authority),action:code(t.action),reason:code(t.reason)}))};
}
