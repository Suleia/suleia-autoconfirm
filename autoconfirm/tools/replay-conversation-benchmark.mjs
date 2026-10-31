import {readFileSync} from 'node:fs';
import {compileCustomerCase} from '../src/customer-context/case-compiler.mjs';
import {resolutionCandidate} from '../src/workflows/incident-resolution-plan.mjs';
import {shadowComparison} from '../src/customer-context/runtime.mjs';
import {evaluateConversationRelease} from '../src/customer-context/release-gates.mjs';
export function benchmarkInput(fixture){
  const conversationId='benchmark-'+fixture.case_id.slice(0,20),order=fixture.order_state,issue=fixture.incident_state;
  const messages=fixture.conversation.map(m=>({id:m.id,type:m.direction==='INBOUND'?'in':'agent',user_ns:conversationId,
    content:m.text,ts:Date.parse(m.at)/1000,...(m.direction==='OUTBOUND'?{mid:'wamid.benchmark-'+m.source_event_hash,payload:{name:m.template||'',body:m.text}}:{})}));
  return {order,incident:{orderId:order.orderId,incidenceId:issue.incidenceId,incidentType:({REFUSED_BY_RECIPIENT:'rejected_goods',RECIPIENT_REJECTED:'rejected_goods',ADDRESS_INCORRECT:'address',RECIPIENT_ABSENT:'absent'})[issue.incidentType]||issue.incidentType,incidenceDate:issue.incidenceDate,chatbyUserNs:conversationId,chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER'},
    issue:{raw:{id:issue.incidenceId,order_id:order.orderId,status:issue.status,is_active:issue.is_active,resolution_status:issue.resolution_status,allowed_resolution_options:issue.allowed_resolution_options}},
    messages,binding:{verified:true,orderId:order.orderId,issueId:issue.incidenceId,conversationId},now:Date.parse(fixture.provenance.snapshot_at),
    policy:{requireDeliveryDate:true,requireDeliveryWindow:true,ownerProvidesDefaultSchedule:['absent','REFUSED_BY_RECIPIENT','rejected_goods'].includes(issue.incidentType),ownerProvidesDefaultDate:['absent','REFUSED_BY_RECIPIENT','rejected_goods'].includes(issue.incidentType),irreversibleAction:issue.resolution_status==='RETURN_REQUESTED'?'RETURN_REQUESTED':null}};
}
export function replayBenchmark(corpus){
  const result={real_cases:corpus.cases.length,reviewed_real_cases:0,source_writes:0,provider_calls:0,
    comparison:{},v2_human_review:0,v3_human_review:0,v2_ambiguous:0,v3_ambiguous:0,proposed_clarifications:0,unanswered_questions_waited:0,read_failures:0,
    wrong_irreversible_route:null,wrong_order_binding:null,owner_routing:null,repeated_clarification:null,blind_retry:null,explicit_return_recall:null,explicit_order_recall:null,date_window_accuracy:null,
    provenance_verified:corpus.cases.every(c=>c.source==='REAL_SANITIZED_PRIVATE_SNAPSHOT'&&c.provenance.binding_evidence_hash),current_replay_verified:false,cases:[]};
  const scored={owner:0,ownerCorrect:0,order:0,orderCorrect:0,returns:0,returnCorrect:0,temporal:0,temporalCorrect:0,irreversibleWrong:0,questionRepeated:0,identityWrong:0,coreProjections:0,coreCorrect:0};
  for(const fixture of corpus.cases){
    try{
      const input=benchmarkInput(fixture),v2=resolutionCandidate(input),v3=compileCustomerCase(input);
      v3.candidate=resolutionCandidate({...input,conversationContext:v3});
      const comparison=shadowComparison(v2,v3);result.comparison[comparison]=(result.comparison[comparison]||0)+1;
      if(v2.twin?.human_review_reason==='CUSTOMER_RESPONSE_REQUIRES_REVIEW')result.v2_ambiguous++;
      if(v2.twin?.current_owner==='HUMAN')result.v2_human_review++;
      if(v3.next_best_action==='HUMAN_REVIEW')result.v3_human_review++;
      if(v3.reason==='UNCLASSIFIED_CUSTOMER_TEXT'||v3.reason==='AMBIGUOUS_CUSTOMER_CONTEXT')result.v3_ambiguous++;
      if(v3.customer_reply_action==='CLARIFY')result.proposed_clarifications++;
      if(v3.reason==='WAITING_CUSTOMER')result.unanswered_questions_waited++;
      let grading=null;
      if(fixture.annotation_status==='REVIEWED'){
        result.reviewed_real_cases++;const errors=[];
        scored.owner++;if(v3.owner===fixture.expected_owner)scored.ownerCorrect++;else errors.push('OWNER_MISMATCH');
        if(v3.dropea_order_id!==input.order.orderId||v3.active_issue_id!==input.incident.incidenceId)scored.identityWrong++;
        for(const [type,value]of Object.entries(fixture.expected_current_facts||{})){
          const correct=v3.current_facts?.[type]?.confidence>=.9&&JSON.stringify(v3.current_facts?.[type]?.value_json)===JSON.stringify(value);
          scored.coreProjections++;if(correct)scored.coreCorrect++;else errors.push('FACT_'+type);
          if(type==='WANTS_ORDER'&&value===true){scored.order++;if(correct)scored.orderCorrect++;}
          if(type==='WANTS_RETURN'&&value===true){scored.returns++;if(correct)scored.returnCorrect++;}
          if(['DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM','TIME_TO'].includes(type)){scored.temporal++;if(correct)scored.temporalCorrect++;}
        }
        for(const type of fixture.expected_present_facts||[])if(!v3.current_facts?.[type])errors.push('MISSING_'+type);
        for(const type of fixture.expected_forbidden_true_facts||[])if(v3.current_facts?.[type]?.confidence>=.9&&v3.current_facts[type].value_json===true)errors.push('FORBIDDEN_'+type);
        for(const type of fixture.expected_uncertain_facts||[])if(v3.current_facts?.[type]?.confidence>=.9)errors.push('UNJUSTIFIED_CERTAINTY_'+type);
        for(const type of fixture.expected_expired_facts||[])if(v3.current_facts?.[type]||!v3.fact_ledger?.some(f=>f.fact_type===type&&f.status==='EXPIRED'))errors.push('EXPIRY_'+type);
        for(const [type,values]of Object.entries(fixture.expected_superseded_facts||{}))for(const value of values)if(!v3.fact_ledger?.some(f=>f.fact_type===type&&JSON.stringify(f.value_json)===JSON.stringify(value)&&f.status==='SUPERSEDED'))errors.push('SUPERSESSION_'+type);
        if(v3.operational_action!==fixture.expected_operational_action)errors.push('OPERATIONAL_ACTION_MISMATCH');
        if(v3.customer_reply_action!==fixture.expected_reply_action)errors.push('REPLY_ACTION_MISMATCH');
        if((v3.next_best_action==='HUMAN_REVIEW')!==fixture.expected_human_review)errors.push('HUMAN_REVIEW_MISMATCH');
        if(JSON.stringify(v3.missing_information)!==JSON.stringify(fixture.expected_missing_information))errors.push('MISSING_INFORMATION_MISMATCH');
        if(v3.operational_action==='REQUEST_RETURN'&&fixture.expected_operational_action!=='REQUEST_RETURN')scored.irreversibleWrong++;
        if(v3.customer_reply_action==='CLARIFY'&&v3.clarifications.some(c=>!c.answered_at))scored.questionRepeated++;
        const intentionallyUnresolved=fixture.review_disposition==='INTENTIONALLY_UNRESOLVED';
        if(intentionallyUnresolved&&(!fixture.unresolved_reason||!v3.unresolved?.length||v3.operational_action!=='NONE'||v3.customer_reply_action!=='NONE'))errors.push('UNRESOLVED_DISPOSITION_NOT_SAFE');
        grading={passed:errors.length===0,errors,disposition:intentionallyUnresolved?'INTENTIONALLY_UNRESOLVED':'EXPECTED',...(intentionallyUnresolved?{reason_code:fixture.unresolved_reason}:{} )};
      }
      result.cases.push({case_id:fixture.case_id,comparison,annotation_status:fixture.annotation_status,
        proposed_current_fact_types:Object.keys(v3.current_facts||{}),proposed_superseded_fact_types:(v3.fact_ledger||[]).filter(f=>f.status==='SUPERSEDED').map(f=>f.fact_type),
        proposed_missing_information:v3.missing_information,proposed_owner:v3.owner,proposed_operational_action:v3.operational_action,proposed_reply_action:v3.customer_reply_action,reason:v3.reason,grading});
    }catch(error){result.read_failures++;result.cases.push({case_id:fixture.case_id,error:error.message?.match(/^[A-Z][A-Z0-9_]+$/)?.[0]||'OFFLINE_COMPILATION_FAILED'});}
  }
  if(result.reviewed_real_cases){
    result.owner_routing=scored.ownerCorrect/scored.owner;
    result.explicit_order_recall=scored.order?scored.orderCorrect/scored.order:null;
    result.explicit_return_recall=scored.returns?scored.returnCorrect/scored.returns:null;
    result.date_window_accuracy=scored.temporal?scored.temporalCorrect/scored.temporal:null;
    result.wrong_irreversible_route=scored.irreversibleWrong;result.wrong_order_binding=scored.identityWrong;result.repeated_clarification=scored.questionRepeated;
    result.core_fact_projection_accuracy=scored.coreProjections?scored.coreCorrect/scored.coreProjections:null;
    result.reviewed_cases_passing=result.cases.filter(c=>c.grading?.passed).length;
    result.intentionally_unresolved_cases=result.cases.filter(c=>c.grading?.passed&&c.grading.disposition==='INTENTIONALLY_UNRESOLVED').length;
    result.expectation_closed_cases=result.reviewed_cases_passing-result.intentionally_unresolved_cases;
  }
  // No provider writes were attempted; blind-retry execution and a current live
  // replay need independent runtime verification, not a guessed perfect score.
  result.release=evaluateConversationRelease(result);return result;
}
if(process.argv[1]?.endsWith('replay-conversation-benchmark.mjs')){
 const corpus=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(replayBenchmark(corpus)));
}
