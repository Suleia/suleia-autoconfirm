import { buildIncidentSimulation } from '../packages/platform-core/src/incident/simulation-record.mjs';
import { decryptOperationsPrivateJson } from '../packages/suleia-operations-mcp/src/operations/private-display.mjs';

// Historical replay is SELECT-only. It never calls the synchronization worker,
// projector or external connectors, and prints hashes/aggregate metrics only.
export async function replayRecipientAbsentShadow({ pool, privateDataKey = '', now = new Date(), limit = 200 }) {
  const rows = await pool.query(`SELECT i.*,o.identity_status,o.canonical_state,l.conversation_status,
    l.conversation_freshness,l.observed_at AS conversation_observed_at
    FROM read_models.operations_incident_records i
    JOIN read_models.operations_order_records o USING(canonical_order_id)
    LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
    WHERE i.type='RECIPIENT_ABSENT' ORDER BY i.updated_at DESC LIMIT $1`,[Math.min(500,limit)]);
  const metrics={total:0,first_absence:0,second_absence:0,unknown_attempt:0,customer_response_available:0,
    customer_response_not_verifiable:0,reschedule_requested:0,pickup_requested:0,return_requested:0,
    logistics_feasible:0,logistics_unknown:0,logistics_not_feasible:0,logistics_stale:0,human_review_required:0,would_automate:0,would_not_automate:0,
    mapping_not_verifiable:0,history_available:0};
  const examples=[];
  for(const row of rows.rows) {
    const events=await pool.query(`SELECT canonical_issue_id,canonical_order_id,direction,message_type,
      occurred_at AS created_at,message_text_ciphertext,intent,incident_relevance,chatby_message_id_hash AS chatby_message_id,
      'CURRENT_ORDER_EXACT_MATCH'::text AS relevance_status
      FROM operations.chatby_private_message_display WHERE canonical_issue_id=$1 ORDER BY occurred_at`,[row.canonical_issue_id]);
    const timer=await pool.query(`SELECT timer_id,timer_type,started_at,due_at,status,policy_version
      FROM operations.incident_timers WHERE canonical_issue_id=$1
      AND timer_type='CUSTOMER_INITIAL_RESPONSE_48H' ORDER BY created_at DESC LIMIT 1`,[row.canonical_issue_id]);
    const history=await pool.query(`SELECT h.* FROM read_models.customer_operational_history h
      JOIN read_models.operations_order_records o ON o.customer_identity_hash=h.customer_key WHERE o.canonical_order_id=$1`,[row.canonical_order_id]);
    const previous=await pool.query(`SELECT count(*)::integer AS previous_absences FROM integration.dropea_issues i
      JOIN read_models.operations_order_records o USING(canonical_order_id)
      WHERE o.customer_identity_hash=(SELECT customer_identity_hash FROM read_models.operations_order_records WHERE canonical_order_id=$1)
      AND i.canonical_order_id<>$1 AND i.canonical_type='RECIPIENT_ABSENT'
      AND i.initial_carrier_code IS DISTINCT FROM 'NAM' AND i.created_at_utc<$2`,[row.canonical_order_id,row.created_at]);
    const result=buildIncidentSimulation({issue:row,order:{canonical_order_id:row.canonical_order_id,identity_status:row.identity_status,canonical_state:row.canonical_state},
      events:events.rows.map(e=>({...e,raw_text:decryptOperationsPrivateJson(e.message_text_ciphertext,privateDataKey)?.text || ''})),
      chatby:{verified:row.conversation_status==='FOUND' && row.conversation_freshness==='FRESH',observed_at:row.conversation_observed_at},
      history:{...history.rows[0],verified:Boolean(history.rows[0]),previous_absences:previous.rows[0]?.previous_absences || 0},
      previousTimer:timer.rows[0] || null,now});
    const s=result.shadow; metrics.total++;
    metrics[s.absence_attempt==='FIRST_ABSENCE'?'first_absence':s.absence_attempt==='SECOND_ABSENCE'?'second_absence':'unknown_attempt']++;
    if(result.interpretation.has_customer_replied) metrics.customer_response_available++;
    if(s.customer_response_status==='NOT_VERIFIABLE' || s.data_freshness.chatby!=='FRESH') metrics.customer_response_not_verifiable++;
    if(s.customer_intent==='RESCHEDULE_DELIVERY')metrics.reschedule_requested++;
    if(s.pickup_requested)metrics.pickup_requested++;
    if(s.customer_intent==='RETURN_REQUEST')metrics.return_requested++;
    if(s.customer_operational_history.verified)metrics.history_available++;
    metrics[s.logistics_feasibility==='FEASIBLE'?'logistics_feasible':s.logistics_feasibility==='NOT_FEASIBLE'?'logistics_not_feasible':s.logistics_feasibility==='STALE_DATA'?'logistics_stale':'logistics_unknown']++;
    if(s.simulation_status==='HUMAN_REVIEW_REQUIRED') {metrics.human_review_required++;metrics.would_not_automate++;} else metrics.would_automate++;
    if(s.blocking_reasons.includes('ABSENT_MAPPING_NOT_VERIFIED'))metrics.mapping_not_verifiable++;
    if(examples.length<6)examples.push({issue_hash:s.input_snapshot_hash,attempt:s.absence_attempt,intent:s.customer_intent,logistics:s.logistics_feasibility,action:s.simulation_action,reasons:s.blocking_reasons});
  }
  return {scope:'CANONICAL_RECIPIENT_ABSENT_CANDIDATES',replay_at:new Date(now).toISOString(),metrics,examples,
    customer_messages_sent:0,dropea_writes:0,gls_writes:0,returns_executed:0,delivery_requests_executed:0,
    agency_pickups_executed:0,production_resolutions:0};
}
