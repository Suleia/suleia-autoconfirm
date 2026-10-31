import {buildCustomerCase,questionContext,hash,OWNERS} from '../customer-care/context.mjs';
import {routeCustomerCase,applyCarePlan} from '../customer-care/policy.mjs';
import {extractWamid} from '../workflows/incident-discount-policy.mjs';
import {currentCustomerIntent} from '../workflows/incident-intent-v2.mjs';
import {madridDate} from '../workflows/incident-intent-v2.mjs';
import {relevantMessageCluster,clusterHash} from './message-cluster.mjs';
import {extractCustomerFacts} from './fact-extractor.mjs';
import {mergeFactLedger,materializeFacts} from './fact-ledger.mjs';
import {requiredMissingInformation} from './missing-information.mjs';
import {clarificationGuard} from './clarification-guard.mjs';
import {composeSafeResponse,questionAnswerBundle} from './response-composer.mjs';
import {contextualQuestion,remainingQuestion} from './question-context.mjs';
import {recurringPreference} from './temporal-facts.mjs';
import {stableCarePolicy} from './live-policy.mjs';
import {reconcileConversationQuestions} from './conversation-obligations.mjs';
import {verifiedProductKnowledge} from './product-knowledge.mjs';
const branded=new WeakMap();
const bindings={WANTS_ORDER:'wants_order',WANTS_RETURN:'wants_return',CANCEL_INTENT:'cancel_intent',DELIVERY_DATE:'delivery_date',DELIVERY_WINDOW:'delivery_window',TIME_FROM:'time_from',TIME_TO:'time_to',CALL_BEFORE_ARRIVAL:'call_before_arrival',REQUESTS_AGENCY:'agency_requested',REPORTS_NO_DELIVERY_ATTEMPT:'reports_no_delivery_attempt',ADDRESS:'address',POSTAL_CODE:'postal_code',ADDRESS_CHANGE_REQUESTED:'address_change_requested'};
const timed=new Set(['TIME_FROM','TIME_TO']);
const providerHash=input=>hash([input.order?.orderId,input.order?.status,input.order?.updatedAt,input.order?.orderAmount,input.order?.raw?.total_amount,input.order?.raw?.currency,input.order?.raw?.payment_method,input.order?.raw?.sub_status,input.issue?.raw||input.issue,input.incident?.incidenceId,input.incident?.chatbyUserNs,input.incident?.chatbyReadVerified,input.incident?.chatbyOrderAssociation]);
const decisionFingerprint=c=>hash([c.case_hash,c.operational_action,c.customer_reply_action,c.wants_order,c.wants_return,c.cancel_intent,c.latest_customer_intents,c.delivery_date,c.delivery_window,c.time_from,c.time_to,c.literal_delivery_preference,c.unresolved,c.provider_snapshot_hash,c.v2_response]);
export function compileCustomerCase(input,previous=null){
  const policy=input.policy||{},now=input.now??Date.now();
  const base=buildCustomerCase({...input,policy},previous);
  if(!base.input_hash)return {...base,version:'CONVERSATION_V3',operational_action:'NONE',customer_reply_action:'NONE',decision_reason_codes:[base.reason],release_eligible:false};
  const events=relevantMessageCluster(input),incoming=[],eventVersions={};
  const attemptKey=String(input.deliveryAttemptKey||`${base.dropea_order_id}:${base.active_issue_id}`);
  let question=null,lastQuestion=null,offer=false,current={},unresolved=[],contradictions=[];
  const slotUncertainty=new Set();
  for(const event of events){
    eventVersions[event.event_id]=event.source_event_hash;
    if(event.direction==='OUTBOUND'){
      if(extractWamid(event.message)){
        question=contextualQuestion(event.message)||question;
        if(contextualQuestion(event.message))lastQuestion=question;
        if(contextualQuestion(event.message)==='DISCOUNT')offer=true;
      }
      continue;
    }
    const raw=event.message.raw||event.message;
    const replied=event.message.payload?.reply_to_mid&&events.find(e=>e.direction==='OUTBOUND'&&extractWamid(e.message)===event.message.payload.reply_to_mid&&e.source_event_at<event.source_event_at);
    const structuredButton=(raw.button_verified===true&&String(raw.order_id)===base.dropea_order_id||replied)?raw.button_payload||null:null;
    const result=extractCustomerFacts(event,{question:replied?contextualQuestion(replied.message):question,offerVerified:offer,incidentType:base.current_incident_type,current,structuredButton});
    const recurring=recurringPreference(event.text),recurrenceEnd=recurring&&/\bhasta\b/i.test(event.text)?result.facts.find(f=>f.type==='DELIVERY_DATE')?.value:null;
    let supportingEvents=[];
    if(recurring&&recurrenceEnd){
      const ids=new Set(incoming.filter(f=>['DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].includes(f.type)&&Date.parse(event.source_event_at)-Date.parse(f.source_event_at)<=30*60000).map(f=>f.source_event_id));
      supportingEvents=events.filter(e=>ids.has(e.event_id)&&e.source_event_at<event.source_event_at);
      result.facts=result.facts.filter(f=>f.type!=='DELIVERY_DATE'); // Until is an expiry boundary, never the delivery day.
      if(supportingEvents.length){
        const literal=[...supportingEvents.map(e=>e.text),event.text].join(' · ');
        if(literal.length<=300)result.facts.push({type:'DELIVERY_AVAILABILITY',value:literal,confidence:.99,evidence_hash:event.source_event_hash});
        else result.unresolved.push('DELIVERY_WINDOW');
      }else result.unresolved.push('DELIVERY_WINDOW');
    }
    if(event.message.payload?.reply_to_mid&&!replied){result.unresolved.push('UNVERIFIED_REPLY_REFERENCE');}
    for(const fact of result.facts)if(fact.confidence>=.9)slotUncertainty.delete(fact.type);
    if(result.facts.some(f=>['TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].includes(f.type)&&f.confidence>=.9))slotUncertainty.delete('DELIVERY_WINDOW');
    for(const type of result.unresolved)if(['TIME_FROM','TIME_TO','DELIVERY_DATE','DELIVERY_WINDOW'].includes(type))slotUncertainty.add(type);
    if(result.facts.some(f=>!['GREETING','THANKS','REQUESTS_CONTACT','CALL_BEFORE_ARRIVAL'].includes(f.type))||result.unresolved.length){unresolved=result.unresolved;contradictions=result.contradictions;}
    if(result.facts.some(f=>f.type==='WANTS_RETURN'&&f.value===true&&f.confidence>=.9))slotUncertainty.clear();
    question=remainingQuestion(question,result.facts);
    const relatedDate=result.facts.find(f=>f.type==='DELIVERY_DATE')?.value||(current.DELIVERY_DATE>=madridDate(Date.parse(event.source_event_at))?current.DELIVERY_DATE:null)||null;
    if(result.facts.some(f=>f.type==='DELIVERY_DATE')){
      // A later date completes a previously supplied window in the same bounded case.
      for(const preference of incoming)if(['DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].includes(preference.type)&&!preference.related_delivery_date&&!preference.recurring)preference.related_delivery_date=relatedDate;
    }
    for(const fact of result.facts){
      current[fact.type]=fact.value;
      const repeating=recurring&&['DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].includes(fact.type);
      incoming.push({...fact,authority:'CUSTOMER_DERIVED',source_event_id:event.event_id,source_event_hash:fact.evidence_hash,source_event_at:event.source_event_at,related_delivery_date:repeating?null:relatedDate,
        ...(repeating?{recurring:true,recurring_until_date:recurrenceEnd||null,supporting_event_hashes:supportingEvents.map(e=>e.source_event_hash)}:{})});
    }
  }
  // These facts come exclusively from trusted workflow/provider inputs, never
  // from the extractor or a semantic response.
  const systemAt=input.policy?.providerReadAt||previous?.trusted_context_first_observed_at||new Date(now).toISOString();
  const controlled=(type,value,authority)=>incoming.push({type,value,authority,confidence:1,source_event_id:hash([type,'trusted']),source_event_hash:hash([type,value,base.dropea_order_id,base.active_issue_id]),source_event_at:systemAt});
  if(input.currentWorkflowOwner&&Object.values(OWNERS).includes(input.currentWorkflowOwner))controlled('WORKFLOW_OWNER',input.currentWorkflowOwner,'SYSTEM_CONTROLLED');
  if(policy.discountAppliedVerified===true)controlled('DISCOUNT_APPLIED_VERIFIED',true,'SYSTEM_CONTROLLED');
  if(policy.lastVerifiedAction?.status==='VERIFIED'&&policy.lastVerifiedAction.at){
    incoming.push({type:policy.lastVerifiedAction.action,value:true,authority:'PROVIDER_VERIFIED',confidence:1,source_event_id:hash(policy.lastVerifiedAction),source_event_hash:hash([base.dropea_order_id,base.active_issue_id,policy.lastVerifiedAction]),source_event_at:policy.lastVerifiedAction.at});
  }
  const ledger=mergeFactLedger(previous?.fact_ledger,incoming,{orderId:base.canonical_order_id,issueId:base.active_issue_id,now,attemptKey,eventVersions});
  const active=materializeFacts(ledger,{now,attemptKey});
  // A later product question/dispute does not reaffirm an older refusal. Keep
  // its history, but require specialist review before projecting a return.
  if(active.WANTS_RETURN?.value_json===true&&active.ASKS_PRODUCT?.value_json===true&&active.ASKS_PRODUCT.source_event_at>active.WANTS_RETURN.source_event_at)
    unresolved.push('PRODUCT_UNSUITABLE_REQUIRES_REVIEW');
  for(const type of slotUncertainty)if(active[type])active[type].confidence=Math.min(active[type].confidence,.55);
  unresolved=[...new Set([...unresolved,...slotUncertainty])];
  const state={...base,version:'CONVERSATION_V3',order_created_at:input.order.createdAt,policy,fact_ledger:ledger,current_facts:active,unresolved,contradictions,trusted_context_first_observed_at:systemAt,
    owner_capabilities:[...new Set(Object.values(OWNERS))],active_workflows:input.activeWorkflows||[],active_waits:input.activeWaits||[],timers:input.timers||[],
    fact_confidence:Object.fromEntries(Object.entries(active).map(([k,v])=>[k,v.confidence]))};
  state.last_outbound_question_type=lastQuestion||state.last_outbound_question_type;
  state.active_outbound_question_type=question;
  for(const clarification of state.clarifications){
    if(clarification.clarification_type!=='LEGACY_PAYMENT')continue;
    const source=events.find(e=>e.direction==='OUTBOUND'&&extractWamid(e.message)===clarification.provider_message_id);
    const type=source?contextualQuestion(source.message):'LEGACY_PAYMENT';
    clarification.legacy_clarification_type='LEGACY_PAYMENT';
    clarification.clarification_type=type;
    if(type==='LEGACY_PAYMENT')clarification.status='INFORMATIONAL_NOT_REQUIRED';
  }
  for(const [type,field]of Object.entries(bindings))state[field]=active[type]?.confidence>=.9?active[type].value_json:null;
  if(active.ACCEPTS_DISCOUNT?.value_json===true)state.discount_response='ACCEPTED';
  if(active.REJECTS_DISCOUNT?.value_json===true)state.discount_response='REJECTED';
  state.wants_return=state.wants_return===true;state.cancel_intent=state.cancel_intent===true;
  state.latest_customer_intents=[...new Set([...base.latest_customer_intents.filter(i=>!['AMBIGUOUS','WANTS_ORDER','WANTS_RETURN','ACCEPTS_DISCOUNT','REJECTS_DISCOUNT','REQUESTS_AGENCY'].includes(i)),...Object.values(active).filter(f=>f.value_json===true&&f.confidence>=.9&&f.authority==='CUSTOMER_DERIVED').map(f=>f.fact_type)])];
  reconcileConversationQuestions(state,events,incoming,previous);
  state.product_context=verifiedProductKnowledge(input.order,{now,questions:state.pending_customer_questions.map(q=>q.type),questionTexts:state.pending_customer_questions.map(q=>events.find(e=>e.source_event_hash===q.source_event_hash)?.text||'')});
  state.confidence=Object.values(active).filter(f=>f.authority==='CUSTOMER_DERIVED').reduce((min,f)=>Math.min(min,f.confidence),1);
  // Specific temporal uncertainty belongs to Missing Information, not a global
  // loss of the already-established desire/date/window.
  state.unresolved_interpretation=unresolved.filter(u=>!timed.has(u));
  if(contradictions.length)state.unresolved_interpretation.push(...contradictions);
  if(!state.has_current_reply)state.unresolved_interpretation=[];
  if(input.historyComplete===false)state.unresolved_interpretation.push('CONVERSATION_HISTORY_INCOMPLETE');
  if(state.wants_order===true&&state.wants_return)state.unresolved_interpretation.push('WANTS_ORDER_VS_RETURN');
  const intent=state.wants_return?'RETURN':state.address_change_requested?'ADDRESS':state.discount_response==='ACCEPTED'?'DISCOUNT_ACCEPT':state.latest_customer_intents.some(i=>i.startsWith('ASKS_'))?'STATUS_REPLY':'REDELIVERY';
  state.missing_information=requiredMissingInformation(state,intent);
  const routed=routeCustomerCase(state,{...policy,...(state.product_context?{verifiedFaq:state.product_context}:{})});
  if(active.DELIVERY_AVAILABILITY?.confidence>=.9&&state.has_current_reply&&state.wants_order&&!state.wants_return&&!policy.irreversibleAction&&!state.unresolved_interpretation.length&&['absent','rejected_goods'].includes(state.current_incident_type)&&(input.issue?.raw||input.issue)?.allowed_resolution_options?.includes('PROVIDE_SOLUTION')){
    Object.assign(routed,{next_best_action:'DELEGATE',capability:'REDELIVERY',owner:OWNERS.REDELIVERY,reason:'COMPOSITE_AVAILABILITY_EXISTING_SOLUTION_CONTRACT',missing_slots:[]});
  }
  if((active.REPORTS_RECEIVED?.value_json||active.REPORTS_CARRIER_PLAN?.value_json)&&!state.wants_return){
    Object.assign(routed,{next_best_action:'WAITING_PROVIDER',capability:null,owner:OWNERS.REDELIVERY,reason:'CUSTOMER_REPORT_REQUIRES_PROVIDER_VERIFICATION'});
  }
  if(timed.size&&unresolved.some(u=>timed.has(u))&&state.wants_order&&!state.wants_return&&!policy.irreversibleAction){
    Object.assign(routed,{next_best_action:'RESPOND',capability:'CONTEXTUAL_CLARIFICATION',owner:OWNERS.CONTEXTUAL_CLARIFICATION,response_type:'CLARIFICATION',reason:'ONLY_REQUIRED_MISSING_FACT',missing_slots:state.missing_information});
  }else if(routed.capability==='CONTEXTUAL_CLARIFICATION')routed.missing_slots=state.missing_information;
  const guard=clarificationGuard(state);
  if(routed.next_best_action==='RESPOND'&&!guard.allowed){Object.assign(routed,{next_best_action:'WAITING_CUSTOMER',capability:null,owner:'HUMAN',reason:guard.reason});state.findings.push(guard.finding);}
  if((input.issue?.raw||input.issue)?.is_active===false){
    state.missing_information=[];
    Object.assign(routed,{next_best_action:'WAITING_PROVIDER',capability:null,owner:OWNERS.REDELIVERY,reason:'INACTIVE_ISSUE_REQUIRES_LOGISTICS_FOLLOWUP',missing_slots:[]});
  }
  const compiled=applyCarePlan(state,routed);
  compiled.operational_action=routed.next_best_action==='DELEGATE'?({REDELIVERY:'RETRY_DELIVERY',RETURN:'REQUEST_RETURN',AGENCY:'PICKUP_AT_AGENCY'}[routed.capability]||routed.capability):'NONE';
  compiled.customer_reply_action=routed.next_best_action==='RESPOND'?(routed.response_type==='CLARIFICATION'?'CLARIFY':'STATUS_RESPONSE'):'NONE';
  compiled.operational_owner=compiled.owner;compiled.reply_owner=compiled.customer_reply_action==='NONE'?null:OWNERS.STATUS_REPLY;
  const verifiedAction=compiled.last_verified_action;
  if(compiled.next_best_action==='WAITING_PROVIDER'&&compiled.reason==='EXISTING_ACTION_AWAITING_LOGISTICS'&&policy.providerReadVerified===true&&policy.providerReadAt&&now-Date.parse(policy.providerReadAt)>=0&&now-Date.parse(policy.providerReadAt)<=60000&&verifiedAction?.status==='VERIFIED'&&['RETRY_DELIVERY','REDELIVERY'].includes(verifiedAction.action)){
    compiled.ack_action_hash=hash(verifiedAction);
    if(previous?.acknowledged_action_hash!==compiled.ack_action_hash){compiled.customer_reply_action='ACKNOWLEDGE_REQUEST';compiled.response_type='ACKNOWLEDGE_REQUEST';compiled.capability='STATUS_REPLY';compiled.reply_owner=OWNERS.STATUS_REPLY;}
  }
  compiled.decision_reason_codes=[routed.reason,...(state.wants_order?['CUSTOMER_WANTS_ORDER']:[]),...(state.delivery_date?['DELIVERY_DATE_KNOWN']:[]),...(state.delivery_window?['DELIVERY_WINDOW_KNOWN']:[])];
  compiled.context_hash=hash([input.binding,input.order?.status,input.issue?.raw||input.issue,stableCarePolicy(policy),compiled.active_workflows,compiled.active_waits,compiled.timers]);
  compiled.provider_snapshot_hash=providerHash(input);
  compiled.cluster_hash=clusterHash(events);
  compiled.case_hash=hash([compiled.cluster_hash,compiled.context_hash,Object.values(active).map(f=>[f.fact_id,f.confidence]),compiled.missing_information,compiled.operational_action,compiled.customer_reply_action]);
  compiled.based_on_case_hash=compiled.case_hash;
  compiled.based_on_context_hash=compiled.context_hash;
  compiled.based_on_input_hash=compiled.input_hash;
  compiled.based_on_conversation_version=compiled.conversation_version;
  compiled.proposed_response=composeSafeResponse(compiled);
  compiled.response_question_fact_ids=compiled.proposed_response?questionAnswerBundle(compiled)?.answeredFactIds||[]:[];
  compiled.plan_hash=hash([routed,compiled.case_hash]);
  compiled.release_eligible=false; // Release requires the separately reviewed benchmark.
  compiled.v2_response=currentCustomerIntent(input);
  if(compiled.time_from||compiled.time_to||active.DELIVERY_AVAILABILITY){
    const eventHashes=new Set(['DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM','TIME_TO','CALL_BEFORE_ARRIVAL','DELIVERY_AVAILABILITY'].flatMap(t=>[active[t]?.source_event_hash,...(active[t]?.supporting_event_hashes||[])]).filter(Boolean));
    compiled.literal_delivery_preference={literal:events.filter(e=>eventHashes.has(e.source_event_hash)).map(e=>e.text).join(' · '),date:compiled.delivery_date,clockInterpretation:'CUSTOMER_CONTEXT_NO_WIDENING'};
  }
  const factsTimeline=ledger.map(f=>({kind:f.status==='SUPERSEDED'?'FACT_SUPERSEDED':f.status==='RETRACTED'?'FACT_RETRACTED':'FACT_EXTRACTED',at:f.source_event_at,fact_type:f.fact_type,fact_id:f.fact_id,authority:f.authority,confidence:f.confidence,status:f.status}));
  compiled.timeline=[...new Map([...compiled.timeline,...factsTimeline].sort((a,b)=>String(a.at).localeCompare(String(b.at))).map(e=>[hash(e),e])).values()].slice(-100);
  branded.set(compiled,decisionFingerprint(compiled));return compiled;
}
export function readCompiledIntent(compiled,input){
  if(!branded.has(compiled)||!compiled.input_hash)return null;
  if(branded.get(compiled)!==decisionFingerprint(compiled))throw Error('V3_COMPILED_CONTEXT_MUTATED');
  if(String(input.order?.orderId)!==compiled.dropea_order_id||String(input.incident?.incidenceId)!==compiled.active_issue_id)throw Error('V3_CONTEXT_IDENTITY_CHANGED');
  if(clusterHash(relevantMessageCluster(input))!==compiled.cluster_hash)throw Error('STALE_PLAN');
  if(providerHash(input)!==compiled.provider_snapshot_hash)throw Error('STALE_PLAN');
  if(compiled.next_best_action==='HUMAN_REVIEW'||compiled.next_best_action==='WAITING_CUSTOMER'||compiled.unresolved?.length)return {status:'NOT_VERIFIABLE',intents:['AMBIGUOUS'],confidence:'LOW',reason:compiled.reason,has_reply:compiled.has_current_reply};
  return {...compiled.v2_response,status:'CLASSIFIED',intents:compiled.latest_customer_intents,confidence:'HIGH',has_reply:compiled.has_current_reply,
    at:compiled.latest_intent_at,event_hash:compiled.case_hash,slot:{date:compiled.delivery_date,time_window:compiled.time_from||compiled.time_to?null:compiled.delivery_window?.toLowerCase()||null},
    ...(compiled.literal_delivery_preference?{literal_delivery_preference:compiled.literal_delivery_preference}:{}),
    customer_intent:compiled.wants_order?'WANTS_ORDER':null,waiting_for_order:compiled.wants_order===true,
    delivery_attempt_denied_by_customer:compiled.reports_no_delivery_attempt===true,requests_redelivery:compiled.operational_action==='RETRY_DELIVERY'};
}
export function assertFreshCompilation(prepared,current){
  if(!prepared.case_hash||prepared.conversation_version!==current.conversation_version||prepared.based_on_case_hash!==current.case_hash)throw Error('STALE_PLAN');
}
