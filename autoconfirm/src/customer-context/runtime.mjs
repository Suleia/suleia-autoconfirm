import {compileCustomerCase} from './case-compiler.mjs';
import {createCustomerCareStore} from '../customer-care/store.mjs';
import {carePolicyFor} from '../customer-care/runtime.mjs';
import {resolutionCandidate} from '../workflows/incident-resolution-plan.mjs';

export function conversationV3Flags(env={}){
  return {enabled:env.CONVERSATION_V3_ENABLED==='true',semantic:env.CONVERSATION_V3_SEMANTIC_ENABLED==='true',
    clarification:env.CONVERSATION_V3_CLARIFICATION_ENABLED==='true',statusReply:env.CONVERSATION_V3_STATUS_REPLY_ENABLED==='true',
    mode:env.CONVERSATION_INTELLIGENCE_V3_MODE||'SHADOW'};
}
export function shadowComparison(v2,v3){
  if(v3.contradictions?.length)return 'V3_CONFLICT';
  if(v3.next_best_action==='HUMAN_REVIEW'&&v2.twin?.current_owner==='HUMAN')return 'SAME_DECISION';
  if(v3.next_best_action==='HUMAN_REVIEW')return 'V3_HUMAN_REVIEW';
  if(v3.next_best_action==='WAITING_CUSTOMER'&&v3.reason==='WAITING_CUSTOMER')return 'V3_AVOIDS_CLARIFICATION';
  if(v2.twin?.human_review_reason==='DELIVERY_DATE_AND_WINDOW_REQUIRED'&&v3.missing_information?.length===1)return 'V3_MORE_SPECIFIC';
  if(v3.candidate?.twin?.next_best_action===v2.twin?.next_best_action&&v3.candidate?.twin?.current_owner===v2.twin?.current_owner)return 'SAME_DECISION';
  return 'V3_DIFFERENT_ROUTE';
}
export function conversationV3Metrics(cases){
  const facts=cases.flatMap(c=>c.fact_ledger||[]),count=cases.length;
  return {cohort:'CURRENT_EXACT_ORDER_V3_CASES',cases:count,messages_processed:cases.reduce((n,c)=>n+Object.keys(c.event_versions||{}).length,0),
    facts_extracted:facts.length,facts_superseded:facts.filter(f=>f.status==='SUPERSEDED').length,
    semantic_fallback_rate:0,semantic_enabled:false,high_confidence_facts:facts.filter(f=>f.confidence>=.9).length,low_confidence_facts:facts.filter(f=>f.confidence<.9).length,
    ambiguous_rate:count?cases.filter(c=>c.unresolved?.length).length/count:null,
    clarifications_sent:0,repeated_clarifications_blocked:cases.filter(c=>c.reason==='WAITING_CUSTOMER').length,
    historical_clarifications:cases.reduce((n,c)=>n+(c.clarifications||[]).length,0),average_clarifications_per_case:count?cases.reduce((n,c)=>n+(c.clarifications||[]).length,0)/count:null,
    customer_reply_resolution_rate:null,stale_plans_prevented:0,change_of_mind_detected:cases.filter(c=>c.change_of_mind_detected>0).length,
    human_escalation_rate:count?cases.filter(c=>c.next_best_action==='HUMAN_REVIEW').length/count:null,
    verified_action_rate:null,delivery_after_recovery:null,return_after_recovery:null,
    comparison:Object.fromEntries(['SAME_DECISION','V3_MORE_SPECIFIC','V3_AVOIDS_CLARIFICATION','V3_DIFFERENT_ROUTE','V3_HUMAN_REVIEW','V3_CONFLICT'].map(k=>[k,cases.filter(c=>c.shadow_comparison===k).length]))};
}
export async function observeConversationV3(items,{env=process.env,store=createCustomerCareStore({prefix:'conversation_v3'}),now=Date.now(),policyFor=carePolicyFor}={}){
  if(!conversationV3Flags(env).enabled)return {enabled:false};
  const cases=[];let failures=0;
  for(const item of items){try{
    const identity={canonical_order_id:String(item.order?.orderId),active_issue_id:String(item.incident?.incidenceId)};
    const prior=await store.load(identity);
    const input={...item,now,policy:policyFor(item),binding:{verified:item.incident.chatbyReadVerified===true&&item.incident.chatbyOrderAssociation==='EXACT_ORDER',orderId:String(item.order?.orderId),issueId:String(item.incident.incidenceId),conversationId:item.incident.chatbyUserNs}};
    const compiled=compileCustomerCase(input,prior?.value);
    compiled.candidate=resolutionCandidate({...input,conversationContext:compiled});
    compiled.shadow_comparison=shadowComparison(resolutionCandidate(input),compiled);
    compiled.mode='SHADOW';compiled.provider_writes=0;
    await store.save(compiled,prior);item.incident.conversationIntelligenceV3=compiled;cases.push(compiled);
  }catch{failures++;}}
  return {enabled:true,mode:'SHADOW',provider_writes:0,failures,metrics:conversationV3Metrics(cases)};
}
