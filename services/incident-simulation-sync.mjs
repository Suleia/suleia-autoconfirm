import { buildIncidentSimulation } from '../packages/platform-core/src/incident/simulation-record.mjs';
import crypto from 'node:crypto';

export async function syncIncidentSimulations({ pool, projector, now = () => new Date(), maxRecords = 500 }) {
  const candidates = await pool.query(`SELECT i.*, o.identity_status, o.total_amount,
    o.lifecycle_classification, o.canonical_state,l.conversation_status,
    l.reason_code AS conversation_reason,l.conversation_freshness,
    l.observed_at AS conversation_observed_at
    FROM read_models.operations_incident_records i
    JOIN read_models.operations_order_records o USING(canonical_order_id)
    LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
    WHERE i.status='PENDING' AND i.is_active=true
    ORDER BY i.updated_at ASC LIMIT $1`, [maxRecords]);
  let interpreted = 0;
  let simulated = 0;
  let blocked = 0;
  for (const row of candidates.rows) {
    const events = await pool.query(`SELECT canonical_issue_id,direction,message_type,button_payload,
      sanitized_text,occurred_at AS created_at,incident_version,relevance_status,intent,intent_confidence,
      chatby_message_id_hash AS chatby_message_id
      FROM operations.chatby_conversation_events
      WHERE canonical_issue_id=$1 ORDER BY occurred_at`, [row.canonical_issue_id]);
    const issue = {
      ...row,
      pickup_point: row.pickup_point_masked,
      source_version: row.source_version || '0.1.0',
      observed_at: row.observed_at || row.updated_at
    };
    const order = {
      canonical_order_id: row.canonical_order_id,
      identity_status: row.identity_status,
      total_amount: row.total_amount,
      lifecycle_classification: row.lifecycle_classification,
      shipped: !['DRAFT','PENDING','CREATING','PENDING_SUPPLIER'].includes(row.canonical_state)
    };
    const gls = {
      delivery_attempt_number: row.delivery_attempt_number,
      pickup_point_verified: Boolean(row.pickup_point_masked?.pickup_point_id_hash),
      package_available_for_pickup: row.pickup_point_masked?.is_active === true,
      agency_distance_km: null
    };
    if (row.conversation_status !== 'FOUND') {
      const chatbyReason = row.conversation_status
        ? `CHATBY_${row.conversation_status}:${row.conversation_reason || 'UNSPECIFIED'}`
        : 'CHATBY_UNKNOWN:LINK_NOT_ASSESSED';
      const sourceEventId = row.source_event_id || `poll:${row.canonical_issue_id}:${row.updated_at}`;
      const simulationId = crypto.createHash('sha256').update(`WAITING_CHATBY_SOURCE|${row.canonical_issue_id}|${row.updated_at}`).digest('hex');
      await projector.upsertIncidentInterpretation({
        canonical_issue_id: row.canonical_issue_id, canonical_order_id: row.canonical_order_id,
        issue_version: row.updated_at, has_customer_replied: false, latest_inbound_message_at: null,
        latest_relevant_message_hash: null, customer_intent: 'UNKNOWN', previous_intents: [],
        intent_changed: false, contradiction: false, requested_date: null,
        requested_time_window: null, requested_detail: null, requested_address_present: false,
        pickup_requested: false, return_requested: false, discount_accepted: false,
        discount_rejected: false, conversation_quality: 'SOURCE_UNAVAILABLE',
        interpretation_confidence: 0, interpretation_summary: chatbyReason,
        messages_used: 0, messages_ignored: 0, missing_information: [chatbyReason],
        freshness: row.freshness || 'UNKNOWN', interpreted_at: now().toISOString()
      });
      await projector.recordIncidentSimulation({
        simulation_id: simulationId, canonical_issue_id: row.canonical_issue_id,
        canonical_order_id: row.canonical_order_id, issue_version: row.updated_at,
        source_event_id: sourceEventId, dropea_snapshot_at: row.observed_at || row.updated_at,
        chatby_snapshot_at: null, policy_version: 'CHATBY_SOURCE_GATE_V1',
        connector_version: row.source_version || '0.1.0', issue_type: row.type,
        delivery_attempt_number: row.delivery_attempt_number || 'UNKNOWN', customer_has_replied: false,
        customer_intent: 'UNKNOWN', interpretation_summary: chatbyReason,
        facts_used: ['DROPEA_ISSUE'], facts_ignored: [],
        allowed_resolution_options: row.allowed_resolution_options || [], gls_feasibility: {},
        simulated_decision: 'BLOCKED', simulated_action: null,
        missing_data: [chatbyReason], blocking_reasons: [chatbyReason, ...(row.blocking_reasons || [])],
        risk: 'HIGH', confidence: 0, qa_status: 'BLOCKED', human_review: true,
        timer_status: null, execution_available: false, external_write_attempted: false,
        actions_executed: 0, production_writes: 0
      });
      interpreted += 1; simulated += 1; blocked += 1;
      continue;
    }
    const result = buildIncidentSimulation({ issue, order, events: events.rows, gls, now: now() });
    await projector.upsertIncidentInterpretation(result.interpretation);
    await projector.recordIncidentSimulation(result.simulation_record);
    await projector.applyIncidentDecision({ issue, interpretation: result.interpretation, decision: result.decision });
    interpreted += 1;
    simulated += 1;
    if (result.decision.qa_result === 'BLOCKED') blocked += 1;
  }
  return Object.freeze({
    ok: true,
    candidates: candidates.rows.length,
    interpreted,
    simulated,
    blocked,
    actions_executed: 0,
    production_writes: 0,
    external_write_attempted: false,
    run_mode: 'SHADOW_READ_ONLY'
  });
}
