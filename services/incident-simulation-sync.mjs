import { buildIncidentSimulation } from '../packages/platform-core/src/incident/simulation-record.mjs';
import crypto from 'node:crypto';
import { decryptOperationsPrivateJson } from '../packages/suleia-operations-mcp/src/operations/private-display.mjs';
import { ABSENT_POLICY_HASH } from '../packages/platform-core/src/incident/absent-evidence.mjs';
import { INCIDENT_NOTIFICATION_TEMPLATES } from '../packages/platform-core/src/incident/notification-evidence.mjs';
import { buildIncidentAutopilotProjection } from '../packages/platform-core/src/incident/autopilot.mjs';

async function persistAutopilot(projector, { issue, order, interpretation, decision, now }) {
  if (typeof projector.recordIncidentAutopilotProjection !== 'function') return null;
  const previousState = typeof projector.getIncidentAutopilotState === 'function'
    ? await projector.getIncidentAutopilotState(issue.canonical_issue_id) : 'DETECTED';
  const projection = buildIncidentAutopilotProjection({
    issue,
    order: { ...order, canonical_state: order.canonical_state || order.lifecycle_classification },
    interpretation,
    decision,
    timer: decision.timer || null,
    previousState: previousState || 'DETECTED',
    now
  });
  await projector.recordIncidentAutopilotProjection(projection);
  return projection;
}

export async function syncIncidentSimulations({ pool, projector, now = () => new Date(), maxRecords = 500, privateDataKey = '', absentLogisticsRead = null, onlyRecipientAbsent = false, excludeRecipientAbsent = false, replayAllAbsent = false, absentTemplateStatus = 'NOT_VERIFIED' }) {
  const candidates = await pool.query(`SELECT i.*, o.identity_status, o.total_amount,
    o.lifecycle_classification, o.canonical_state,l.conversation_status,
    l.reason_code AS conversation_reason,l.conversation_freshness,
    l.observed_at AS conversation_observed_at,l.notification_observed_at AS incident_notified_at,
    l.history_covered_from,l.chatby_conversation_id_hash,l.chatby_contact_id_hash
    FROM read_models.operations_incident_records i
    JOIN read_models.operations_order_records o USING(canonical_order_id)
    LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
    WHERE ((i.status='PENDING' AND i.is_active=true)
      OR ($4::boolean=true AND i.type='RECIPIENT_ABSENT')
      OR (i.type='RECIPIENT_ABSENT' AND i.absent_shadow IS NULL))
      AND ($2::boolean=false OR i.type='RECIPIENT_ABSENT')
      AND ($3::boolean=false OR i.type<>'RECIPIENT_ABSENT')
    ORDER BY i.updated_at ASC LIMIT $1`, [maxRecords,onlyRecipientAbsent,excludeRecipientAbsent,replayAllAbsent]);
  let interpreted = 0;
  let simulated = 0;
  let blocked = 0;
  for (const row of candidates.rows) {
    const events = await pool.query(`SELECT canonical_issue_id,canonical_order_id,direction,message_type,button_payload,
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
    if (row.type === 'RECIPIENT_ABSENT') {
      const evidence = await pool.query(`SELECT m.canonical_issue_id,m.canonical_order_id,m.direction,m.message_type,
        m.occurred_at AS created_at,m.message_text_ciphertext,m.intent,m.context_template_slug,m.incident_relevance,
        m.chatby_message_id_hash AS chatby_message_id,e.button_payload,e.chatby_conversation_id_hash,e.chatby_contact_id_hash,
        'CURRENT_ORDER_EXACT_MATCH'::text AS relevance_status
        FROM operations.chatby_private_message_display m LEFT JOIN operations.chatby_conversation_events e
        ON e.canonical_issue_id=m.canonical_issue_id AND e.chatby_message_id_hash=m.chatby_message_id_hash
        WHERE m.canonical_order_id=$1 ORDER BY m.occurred_at`, [row.canonical_order_id]);
      const timers = await pool.query(`SELECT timer_id,timer_type,started_at,due_at,status,policy_version
        FROM operations.incident_timers WHERE canonical_issue_id=$1
        AND timer_type IN('CUSTOMER_INITIAL_RESPONSE_48H','INCIDENT_AUSENTE_48H')
        AND status='ACTIVE' AND due_at-started_at=interval '48 hours'
        ORDER BY started_at ASC,created_at ASC LIMIT 1`, [row.canonical_issue_id]);
      const history = await pool.query(`SELECT h.* FROM read_models.customer_operational_history h
        JOIN read_models.operations_order_records o ON o.customer_identity_hash=h.customer_key
        WHERE o.canonical_order_id=$1`, [row.canonical_order_id]);
      const previous = await pool.query(`SELECT count(*)::integer AS previous_absences
        FROM integration.dropea_issues i JOIN read_models.operations_order_records o USING(canonical_order_id)
        WHERE o.customer_identity_hash=(SELECT customer_identity_hash FROM read_models.operations_order_records WHERE canonical_order_id=$1)
        AND i.canonical_order_id<>$1 AND i.canonical_type='RECIPIENT_ABSENT'
        AND i.initial_carrier_code IS DISTINCT FROM 'NAM' AND i.created_at_utc<$2`, [row.canonical_order_id, row.created_at]);
      const fresh = await pool.query(`SELECT last_successful_sync_at FROM read_models.operations_data_freshness
        WHERE market=$1 AND store_id=$2 AND resource_type='issues' AND pagination_complete=true
        ORDER BY last_successful_sync_at DESC LIMIT 1`, [row.market || 'ES', row.store_id]);
      const clearEvents = evidence.rows.map(e => ({ ...e,
        raw_text: decryptOperationsPrivateJson(e.message_text_ciphertext, privateDataKey)?.text || '',
        message_text_ciphertext: undefined }));
      const context = absentLogisticsRead ? await absentLogisticsRead(issue) : { gls: {} };
      const notificationEvent=clearEvents.find(e=>e.canonical_issue_id===row.canonical_issue_id
        && e.canonical_order_id===row.canonical_order_id && e.direction==='OUTBOUND' && e.message_type==='TEMPLATE'
        && e.context_template_slug==='dropea_ausente_v3' && e.chatby_message_id
        && new Date(e.created_at).getTime()===new Date(row.incident_notified_at).getTime());
      const policy=await pool.query(`SELECT p.id AS policy_id,v.checksum AS policy_snapshot_hash,a.status
        FROM configuration.policies p JOIN configuration.policy_versions v USING(policy_name)
        JOIN configuration.policy_assignments a ON a.policy_id=p.id AND a.version_id=v.id
        WHERE p.policy_name='RECIPIENT_ABSENT_POLICY_V1' AND v.version='RECIPIENT_ABSENT_POLICY_V1'
        AND a.workflow='RECIPIENT_ABSENT' AND a.status='SHADOW' AND v.status='SHADOW' AND v.checksum=$1`,[ABSENT_POLICY_HASH]);
      const timeline=await pool.query(`SELECT canonical_issue_id AS event_id,canonical_order_id,created_at_utc AS event_at,
        'RECIPIENT_ABSENT'::text AS normalized_type,true AS verified FROM integration.dropea_issues
        WHERE canonical_order_id=$1 AND canonical_type='RECIPIENT_ABSENT' AND initial_carrier_code IS DISTINCT FROM 'NAM'
        AND created_at_utc<=$2`,[row.canonical_order_id,row.created_at]);
      // A recent getOrder read is not evidence that the issue collection is recent.
      const result = buildIncidentSimulation({ issue: { ...issue, last_successful_sync_at: fresh.rows[0]?.last_successful_sync_at,
          capability_status: row.capability_status || 'NOT_DECLARED' }, order: { ...order, canonical_state: context.order_state || row.canonical_state },
        events: clearEvents.length ? clearEvents : events.rows, gls: { ...gls, ...context.gls },
        chatby: { verified: row.conversation_status === 'FOUND' && row.conversation_freshness === 'FRESH',
          incident_notified_at: row.incident_notified_at,
          notification_template_name:notificationEvent?.context_template_slug || null,
          notification_message_id:notificationEvent?.chatby_message_id || null,
          template_status: absentTemplateStatus,
          chatby_conversation_id_hash:row.chatby_conversation_id_hash,chatby_contact_id_hash:row.chatby_contact_id_hash,
          observed_at: row.conversation_observed_at, template_contact_verified: clearEvents.some(e => e.canonical_issue_id===row.canonical_issue_id
            && e.direction==='OUTBOUND' && e.message_type==='TEMPLATE' && INCIDENT_NOTIFICATION_TEMPLATES.RECIPIENT_ABSENT.includes(e.context_template_slug)
            && new Date(e.created_at)>=new Date(row.created_at)) },
        history: { ...history.rows[0], verified: Boolean(history.rows[0]), previous_absences: previous.rows[0]?.previous_absences || 0 },
        previousTimer: timers.rows[0] || null,timeline:timeline.rows,policy:{...policy.rows[0],registry_required:true}, now: now() });
      await projector.upsertIncidentInterpretation(result.interpretation);
      await projector.recordIncidentSimulation(result.simulation_record);
      await projector.applyRecipientAbsentShadow({ issue, interpretation: result.interpretation, decision: result.decision });
      await persistAutopilot(projector, { issue, order: { ...order, canonical_state: context.order_state || row.canonical_state },
        interpretation: result.interpretation, decision: result.decision, now: now() });
      interpreted += 1; simulated += 1;
      if (result.decision.qa_result === 'BLOCKED') blocked += 1;
      continue;
    }
    if (row.conversation_status !== 'FOUND') {
      const chatbyReason = row.conversation_status
        ? `CHATBY_${row.conversation_status}:${row.conversation_reason || 'UNSPECIFIED'}`
        : 'CHATBY_UNKNOWN:LINK_NOT_ASSESSED';
      const sourceEventId = row.source_event_id || `poll:${row.canonical_issue_id}:${row.updated_at}`;
      const simulationId = crypto.createHash('sha256').update(`WAITING_CHATBY_SOURCE|${row.canonical_issue_id}|${row.updated_at}`).digest('hex');
      const interpretation = {
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
      };
      const simulationRecord = {
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
      };
      await projector.upsertIncidentInterpretation(interpretation);
      await projector.recordIncidentSimulation(simulationRecord);
      await persistAutopilot(projector, { issue, order: { ...order, canonical_state: row.canonical_state },
        interpretation, decision: {
          decision_id: simulationId, policy_version: 'CHATBY_SOURCE_GATE_V1',
          simulated_action: null, requires_human_review: true, qa_result: 'BLOCKED',
          blocking_reasons: simulationRecord.blocking_reasons
        }, now: now() });
      interpreted += 1; simulated += 1; blocked += 1;
      continue;
    }
    const result = buildIncidentSimulation({ issue, order, events: events.rows, gls, now: now() });
    await projector.upsertIncidentInterpretation(result.interpretation);
    await projector.recordIncidentSimulation(result.simulation_record);
    await projector.applyIncidentDecision({ issue, interpretation: result.interpretation, decision: result.decision });
    await persistAutopilot(projector, { issue, order: { ...order, canonical_state: row.canonical_state },
      interpretation: result.interpretation, decision: result.decision, now: now() });
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
