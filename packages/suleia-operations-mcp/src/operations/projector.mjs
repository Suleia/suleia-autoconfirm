import { containsDirectPii } from '../shadow/masking.mjs';

function assertSafe(record) {
  if (containsDirectPii(record)) throw new Error('Operations projection rejected direct PII');
}

export class OperationsProjector {
  constructor(pool) {
    this.pool = pool;
  }

  async upsertOrder(order) {
    assertSafe(order);
    await this.pool.query(`INSERT INTO read_models.operations_order_records
      (canonical_order_id,dropea_order_id,external_order_id_hash,status,sub_status,canonical_state,
       product_summary,total_amount,currency,carrier,service_type,tracking_reference_masked,
       identity_status,decision_status,risk,priority,freshness,latest_message_at,updated_at,
       source_version,schema_version,actions_executed,production_writes,run_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,0,0,'SHADOW_READ_ONLY')
      ON CONFLICT(canonical_order_id) DO UPDATE SET
       dropea_order_id=EXCLUDED.dropea_order_id,external_order_id_hash=EXCLUDED.external_order_id_hash,
       status=EXCLUDED.status,sub_status=EXCLUDED.sub_status,canonical_state=EXCLUDED.canonical_state,
       product_summary=EXCLUDED.product_summary,total_amount=EXCLUDED.total_amount,currency=EXCLUDED.currency,
       carrier=EXCLUDED.carrier,service_type=EXCLUDED.service_type,
       tracking_reference_masked=EXCLUDED.tracking_reference_masked,identity_status=EXCLUDED.identity_status,
       freshness=EXCLUDED.freshness,updated_at=EXCLUDED.updated_at,source_version=EXCLUDED.source_version,
       schema_version=EXCLUDED.schema_version`, [
      order.canonical_order_id, order.dropea_order_id, order.external_order_id_hash,
      order.status, order.sub_status, order.canonical_state, order.product_summary,
      order.total_amount, order.currency, order.carrier, order.service_type,
      order.tracking_reference_masked, order.identity_status,
      order.decision_status || 'NOT_ASSESSED', order.risk || 'NOT_ASSESSED',
      order.priority || 'NORMAL', order.data_freshness || 'UNKNOWN',
      order.latest_message_at || null, order.updated_at, order.source_version, order.schema_version
    ]);
    return { projected: true, resource: 'order', actions_executed: 0, production_writes: 0 };
  }

  async upsertIssue(issue) {
    assertSafe(issue);
    await this.pool.query(`INSERT INTO read_models.operations_incident_records
      (canonical_issue_id,dropea_issue_id,canonical_order_id,dropea_order_id,type,status,is_active,
       actionable,carrier,tracking_reference_masked,initial_carrier_code,
       initial_carrier_description_sanitized,initial_carrier_substatus_code,
       allowed_resolution_options,pickup_point_masked,delivery_attempt_number,
       carrier_retention_deadline,customer_response_status,customer_intent,proposed_resolution,
       decision_id,policy_id,confidence,risk,priority,qa_result,blocking_reasons,due_at,
       discount_status,freshness,created_at,updated_at,actions_executed,production_writes,run_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,0,0,'SHADOW_READ_ONLY')
      ON CONFLICT(canonical_issue_id) DO UPDATE SET
       status=EXCLUDED.status,is_active=EXCLUDED.is_active,actionable=EXCLUDED.actionable,
       allowed_resolution_options=EXCLUDED.allowed_resolution_options,pickup_point_masked=EXCLUDED.pickup_point_masked,
       delivery_attempt_number=EXCLUDED.delivery_attempt_number,carrier_retention_deadline=EXCLUDED.carrier_retention_deadline,
       customer_response_status=EXCLUDED.customer_response_status,customer_intent=EXCLUDED.customer_intent,
       proposed_resolution=EXCLUDED.proposed_resolution,decision_id=EXCLUDED.decision_id,
       policy_id=EXCLUDED.policy_id,confidence=EXCLUDED.confidence,risk=EXCLUDED.risk,
       priority=EXCLUDED.priority,qa_result=EXCLUDED.qa_result,blocking_reasons=EXCLUDED.blocking_reasons,
       due_at=EXCLUDED.due_at,discount_status=EXCLUDED.discount_status,freshness=EXCLUDED.freshness,
       updated_at=EXCLUDED.updated_at`, [
      issue.canonical_issue_id, issue.dropea_issue_id, issue.canonical_order_id, issue.dropea_order_id,
      issue.type, issue.status, issue.is_active, issue.actionable, issue.carrier,
      issue.tracking_reference_masked, issue.initial_carrier_code,
      issue.initial_carrier_description_sanitized, issue.initial_carrier_substatus_code,
      issue.allowed_resolution_options, issue.pickup_point, issue.delivery_attempt_number || 'UNKNOWN',
      issue.carrier_retention_deadline, issue.customer_response_status || 'UNKNOWN',
      issue.customer_intent || 'UNKNOWN', issue.proposed_resolution, issue.decision_id,
      issue.policy_id, issue.confidence === null || issue.confidence === undefined ? null : Number(issue.confidence) / 100,
      issue.risk || 'NOT_ASSESSED', issue.priority || 'NORMAL', issue.qa_result || 'PENDING',
      issue.blocking_reasons || [], issue.due_at, issue.discount_status || 'NOT_OFFERED',
      issue.freshness || 'UNKNOWN', issue.created_at, issue.updated_at
    ]);
    return { projected: true, resource: 'issue', actions_executed: 0, production_writes: 0 };
  }

  async connectorHealth(record) {
    assertSafe(record);
    await this.pool.query(`INSERT INTO read_models.operations_connector_health
      (connector,transport_health,data_health,last_success_at,last_failure_at,lag_seconds,pagination_complete,checked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(connector) DO UPDATE SET transport_health=EXCLUDED.transport_health,
       data_health=EXCLUDED.data_health,last_success_at=EXCLUDED.last_success_at,
       last_failure_at=EXCLUDED.last_failure_at,lag_seconds=EXCLUDED.lag_seconds,
       pagination_complete=EXCLUDED.pagination_complete,checked_at=EXCLUDED.checked_at`, [
      record.connector, record.transport_health, record.data_health, record.last_success_at,
      record.last_failure_at, record.lag_seconds, record.pagination_complete, record.checked_at
    ]);
    return { projected: true, resource: 'connector_health', actions_executed: 0, production_writes: 0 };
  }
}
