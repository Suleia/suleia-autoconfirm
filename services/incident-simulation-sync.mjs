import { buildIncidentSimulation } from '../packages/platform-core/src/incident/simulation-record.mjs';

export async function syncIncidentSimulations({ pool, projector, now = () => new Date(), maxRecords = 500 }) {
  const candidates = await pool.query(`SELECT i.*, o.identity_status, o.total_amount,
    o.lifecycle_classification, o.canonical_state
    FROM read_models.operations_incident_records i
    JOIN read_models.operations_order_records o USING(canonical_order_id)
    WHERE i.status='PENDING' AND i.is_active=true
    ORDER BY i.updated_at ASC LIMIT $1`, [maxRecords]);
  let interpreted = 0;
  let simulated = 0;
  let blocked = 0;
  for (const row of candidates.rows) {
    const events = await pool.query(`SELECT canonical_issue_id,direction,message_type,button_payload,
      sanitized_text,occurred_at AS created_at,incident_version,intent,intent_confidence,
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
