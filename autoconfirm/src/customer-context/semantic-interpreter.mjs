import {validateCustomerFacts} from './fact-extractor.mjs';
const confidential=/\b\d{5,}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:calle|avenida|avda|carrer|paseo)\s+[^,.!?]+/gi;
export function compileSemanticContext(context,events){
  const safeFacts=Object.values(context.current_facts||{}).filter(f=>!['ADDRESS','PHONE','POSTAL_CODE','CITY','PROVINCE'].includes(f.fact_type));
  return {order_state:context.current_order_state,incident_type:context.current_incident_type,
    current_facts:safeFacts.map(f=>({type:f.fact_type,value:f.value_json,confidence:f.confidence})),
    superseded_facts:(context.fact_ledger||[]).filter(f=>f.status==='SUPERSEDED'&&!['ADDRESS','PHONE','POSTAL_CODE','CITY','PROVINCE'].includes(f.fact_type)).slice(-8).map(f=>({type:f.fact_type,value:f.value_json})),
    last_question:context.last_outbound_question_type,missing:context.missing_information||[],
    recent_messages:events.filter(e=>e.direction==='INBOUND').slice(-6).map(e=>({text:e.text.replace(confidential,'[PRIVATE]').slice(0,500),evidence_hash:e.source_event_hash})),
    previous_actions:context.last_verified_action?[{action:context.last_verified_action.action,status:context.last_verified_action.status}]:[],
    owner_capabilities:context.owner_capabilities||[]};
}
// No provider SDK/key/transport is installed by this module. An authorized
// provider implementation must pass its own credential/budget gate first.
export async function semanticFallback(context,events,{enabled=false,budgetUsd=0,interpret=null}={}){
  const needed=context.unresolved?.length>0||context.confidence<.65;
  if(!needed)return {status:'NOT_NEEDED',facts:[]};
  if(!enabled||budgetUsd<=0||typeof interpret!=='function')return {status:'DISABLED',facts:[]};
  const result=validateCustomerFacts(await interpret(compileSemanticContext(context,events)),events);
  return {status:'VALIDATED_CUSTOMER_FACTS_ONLY',...result};
}
