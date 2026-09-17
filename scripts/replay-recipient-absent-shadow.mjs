import { syncIncidentSimulations } from '../services/incident-simulation-sync.mjs';

// Reuse exactly the worker's canonical SELECT-only inputs and policy. This
// collector has no write-capable projector or external connector. No fixed cap.
export async function replayRecipientAbsentShadow({pool,privateDataKey='',now=new Date(),templateStatus='NOT_VERIFIED'}) {
  const population=await pool.query("SELECT count(*)::integer AS total FROM read_models.operations_incident_records WHERE type='RECIPIENT_ABSENT'");
  const total=Number(population.rows[0]?.total || 0);
  const metrics={total:0,active_pending:0,first_absence:0,second_absence:0,unknown_attempt:0,address_review:0,normal_absent:0,
    customer_response_available:0,customer_response_not_verifiable:0,no_response:0,reschedule_requested:0,pickup_requested:0,return_requested:0,
    logistics_feasible:0,logistics_unknown:0,logistics_not_feasible:0,logistics_stale:0,human_review_required:0,would_automate:0,would_not_automate:0,
    active_would_automate:0,waiting_customer:0,policy_not_persisted:0,mapping_not_verifiable:0,history_available:0};
  const reasonCounts={},actionCounts={},examples=[];
  const projector={upsertIncidentInterpretation:async()=>{},recordIncidentSimulation:async()=>{},applyRecipientAbsentShadow:async({issue,decision})=>{
    const s=decision.absent_shadow;metrics.total++;
    if(issue.status==='PENDING' && issue.is_active)metrics.active_pending++;
    metrics[s.absence_attempt==='FIRST_ABSENCE'?'first_absence':s.absence_attempt==='SECOND_ABSENCE'?'second_absence':'unknown_attempt']++;
    metrics[s.interpreted_type==='RECIPIENT_ABSENT'?'normal_absent':'address_review']++;
    if(s.customer_response_status==='RESPONDED')metrics.customer_response_available++;
    if(s.customer_response_status==='NOT_VERIFIABLE')metrics.customer_response_not_verifiable++;
    if(s.customer_response_status==='NO_RESPONSE')metrics.no_response++;
    if(s.customer_intent==='RESCHEDULE_DELIVERY')metrics.reschedule_requested++;
    if(s.pickup_requested)metrics.pickup_requested++;
    if(s.customer_intent==='RETURN_REQUEST')metrics.return_requested++;
    if(s.waiting_customer)metrics.waiting_customer++;
    if(s.customer_operational_history.verified)metrics.history_available++;
    metrics[s.logistics_feasibility==='FEASIBLE'?'logistics_feasible':s.logistics_feasibility==='NOT_FEASIBLE'?'logistics_not_feasible':s.logistics_feasibility==='STALE_DATA'?'logistics_stale':'logistics_unknown']++;
    if(s.simulation_status==='HUMAN_REVIEW_REQUIRED'){metrics.human_review_required++;metrics.would_not_automate++;}
    else{metrics.would_automate++;if(issue.status==='PENDING' && issue.is_active)metrics.active_would_automate++;}
    for(const reason of s.blocking_reasons)reasonCounts[reason]=(reasonCounts[reason] || 0)+1;
    if(s.blocking_reasons.includes('POLICY_NOT_PERSISTED'))metrics.policy_not_persisted++;
    if(s.blocking_reasons.includes('ABSENT_MAPPING_NOT_VERIFIED'))metrics.mapping_not_verifiable++;
    actionCounts[s.simulation_action]=(actionCounts[s.simulation_action] || 0)+1;
    if(examples.length<6)examples.push({input_hash:s.input_snapshot_hash,attempt:s.absence_attempt,intent:s.customer_intent,action:s.simulation_action,reasons:s.blocking_reasons});
  }};
  await syncIncidentSimulations({pool,projector,privateDataKey,now:()=>new Date(now),maxRecords:total || 1,
    onlyRecipientAbsent:true,replayAllAbsent:true,absentTemplateStatus:templateStatus});
  if(metrics.total!==total)throw new Error('ABSENT_REPLAY_POPULATION_CHANGED_RETRY_READONLY');
  return {scope:'ALL_CANONICAL_RECIPIENT_ABSENT_SELECT_ONLY',replay_at:new Date(now).toISOString(),population_count:total,metrics,
    reason_counts:reasonCounts,action_counts:actionCounts,examples,
    automation_candidate_rate:total?metrics.would_automate/total*100:0,
    active_candidate_rate:metrics.active_pending?metrics.active_would_automate/metrics.active_pending*100:0,
    limitations:['CARRIER_OPERATIONAL_CAPABILITY_NOT_FABRICATED','HISTORICAL_CHATBY_UNREAD_IS_NOT_SILENCE'],
    customer_messages_sent:0,dropea_writes:0,gls_writes:0,returns_executed:0,delivery_requests_executed:0,
    agency_pickups_executed:0,incident_auto_closes:0,production_resolutions:0,production_writes:0};
}
