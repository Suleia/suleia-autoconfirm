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
    comparison:{},v2_ambiguous:0,v3_ambiguous:0,proposed_clarifications:0,unanswered_questions_waited:0,read_failures:0,
    wrong_irreversible_route:null,wrong_order_binding:null,owner_routing:null,repeated_clarification:null,blind_retry:null,explicit_return_recall:null,explicit_order_recall:null,date_window_accuracy:null,
    provenance_verified:corpus.cases.every(c=>c.source==='REAL_SANITIZED_PRIVATE_SNAPSHOT'&&c.provenance.binding_evidence_hash),current_replay_verified:false,cases:[]};
  for(const fixture of corpus.cases){
    try{
      const input=benchmarkInput(fixture),v2=resolutionCandidate(input),v3=compileCustomerCase(input);
      v3.candidate=resolutionCandidate({...input,conversationContext:v3});
      const comparison=shadowComparison(v2,v3);result.comparison[comparison]=(result.comparison[comparison]||0)+1;
      if(v2.twin?.human_review_reason==='CUSTOMER_RESPONSE_REQUIRES_REVIEW')result.v2_ambiguous++;
      if(v3.next_best_action==='HUMAN_REVIEW')result.v3_ambiguous++;
      if(v3.customer_reply_action==='CLARIFY')result.proposed_clarifications++;
      if(v3.reason==='WAITING_CUSTOMER')result.unanswered_questions_waited++;
      if(fixture.annotation_status==='REVIEWED')result.reviewed_real_cases++;
      result.cases.push({case_id:fixture.case_id,comparison,annotation_status:fixture.annotation_status,
        proposed_current_fact_types:Object.keys(v3.current_facts||{}),proposed_superseded_fact_types:(v3.fact_ledger||[]).filter(f=>f.status==='SUPERSEDED').map(f=>f.fact_type),
        proposed_missing_information:v3.missing_information,proposed_owner:v3.owner,proposed_operational_action:v3.operational_action,proposed_reply_action:v3.customer_reply_action,reason:v3.reason});
    }catch(error){result.read_failures++;result.cases.push({case_id:fixture.case_id,error:error.message?.match(/^[A-Z][A-Z0-9_]+$/)?.[0]||'OFFLINE_COMPILATION_FAILED'});}
  }
  // This is a comparison, not independent annotation or a current live replay.
  // Never infer perfect safety/recall metrics from unreviewed proposed outputs.
  result.release=evaluateConversationRelease(result);return result;
}
if(process.argv[1]?.endsWith('replay-conversation-benchmark.mjs')){
 const corpus=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(replayBenchmark(corpus)));
}
