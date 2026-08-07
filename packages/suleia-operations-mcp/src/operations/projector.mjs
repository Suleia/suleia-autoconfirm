import { containsDirectPii } from '../shadow/masking.mjs';

function assertSafe(record) {
  if (containsDirectPii(record)) throw new Error('Operations projection rejected direct PII');
}

export class OperationsProjector {
  constructor(pool) {
    this.pool = pool;
  }

  async upsertStoreConfig(config) {
    await this.pool.query(`INSERT INTO integration.dropea_store_config
      (market,store_id,base_url,jwt_secret_reference,jwt_expires_at,migration_cutover_at,
       native_v2_activation_at,historical_reingestion_allowed,enabled)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)
      ON CONFLICT(market,store_id) DO UPDATE SET base_url=EXCLUDED.base_url,
       jwt_secret_reference=EXCLUDED.jwt_secret_reference,jwt_expires_at=EXCLUDED.jwt_expires_at,
       migration_cutover_at=EXCLUDED.migration_cutover_at,
       native_v2_activation_at=EXCLUDED.native_v2_activation_at,
       historical_reingestion_allowed=EXCLUDED.historical_reingestion_allowed,enabled=true,updated_at=now()`, [
      config.market, String(config.store_id), config.base_url, config.jwt_secret_reference,
      config.jwt_expires_at, config.migration_cutover_at, config.native_v2_activation_at,
      config.historical_reingestion_allowed === true
    ]);
    return { projected: true, resource: 'store_config', actions_executed: 0, production_writes: 0 };
  }

  async resolveCanonicalOrder(order) {
    const result = await this.pool.query(`SELECT canonical_order_id FROM read_models.operations_order_records
      WHERE (market=$1 AND store_id=$2 AND dropea_order_id=$3)
         OR (external_order_id_hash IS NOT NULL AND external_order_id_hash=$4)
      ORDER BY updated_at DESC LIMIT 2`, [
      order.market, String(order.store_id), order.dropea_order_id, order.external_order_id_hash
    ]);
    const ids = [...new Set((result.rows || []).map((row) => row.canonical_order_id))];
    if (ids.length > 1) return { status: 'CONFLICT', canonical_order_id: null };
    if (ids.length === 1) return { status: 'FOUND', canonical_order_id: ids[0] };
    return { status: 'NOT_FOUND', canonical_order_id: null };
  }

  async resolveCanonicalOrderByDropeaId({ market, storeId, dropeaOrderId }) {
    const result = await this.pool.query(`SELECT canonical_order_id FROM read_models.operations_order_records
      WHERE market=$1 AND store_id=$2 AND dropea_order_id=$3
      ORDER BY updated_at DESC LIMIT 2`, [market, String(storeId), String(dropeaOrderId)]);
    const ids = [...new Set((result.rows || []).map((row) => row.canonical_order_id))];
    if (ids.length > 1) return { status: 'CONFLICT', canonical_order_id: null };
    if (ids.length === 1) return { status: 'FOUND', canonical_order_id: ids[0] };
    return { status: 'NOT_FOUND', canonical_order_id: null };
  }

  async upsertOrder(order) {
    assertSafe(order);
    const integrationResult = await this.pool.query(`/* SHADOW_READ_ONLY */ INSERT INTO integration.dropea_orders
      (market,store_id,dropea_order_id,canonical_order_id,external_order_id_hash,external_order_id_ciphertext,status,sub_status,
       lifecycle_status,total_amount,currency,payment_method,carrier,service_type,line_items_masked,
       canonical_product_keys,product_display_names,normalized_address_hash,shipping_address_ciphertext,address_line_2_present,
       created_at_utc,updated_at_utc,confirmed_at_utc,delivered_at_utc,source_system,source_version,
       schema_version,observed_at,payload_hash,data_freshness,historical_pre_cutover)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,$29,$30,$31)
      ON CONFLICT(market,store_id,dropea_order_id) DO UPDATE SET
       canonical_order_id=EXCLUDED.canonical_order_id,external_order_id_hash=EXCLUDED.external_order_id_hash,
       external_order_id_ciphertext=EXCLUDED.external_order_id_ciphertext,
       status=EXCLUDED.status,sub_status=EXCLUDED.sub_status,lifecycle_status=EXCLUDED.lifecycle_status,
       total_amount=EXCLUDED.total_amount,currency=EXCLUDED.currency,payment_method=EXCLUDED.payment_method,
       carrier=EXCLUDED.carrier,service_type=EXCLUDED.service_type,line_items_masked=EXCLUDED.line_items_masked,
       canonical_product_keys=EXCLUDED.canonical_product_keys,product_display_names=EXCLUDED.product_display_names,
       normalized_address_hash=EXCLUDED.normalized_address_hash,
       shipping_address_ciphertext=EXCLUDED.shipping_address_ciphertext,
       address_line_2_present=EXCLUDED.address_line_2_present,
       updated_at_utc=EXCLUDED.updated_at_utc,confirmed_at_utc=EXCLUDED.confirmed_at_utc,
       delivered_at_utc=EXCLUDED.delivered_at_utc,source_system=EXCLUDED.source_system,
       source_version=EXCLUDED.source_version,schema_version=EXCLUDED.schema_version,
       observed_at=EXCLUDED.observed_at,payload_hash=EXCLUDED.payload_hash,
       data_freshness=EXCLUDED.data_freshness,last_seen_at=now(),
       shadow_mirror_writes=integration.dropea_orders.shadow_mirror_writes+1
      RETURNING (xmax = 0) AS inserted`, [
      order.market, String(order.store_id), order.dropea_order_id, order.canonical_order_id,
      order.external_order_id_hash, order.external_order_id_ciphertext, order.status, order.sub_status, order.canonical_state,
      order.total_amount, order.currency, order.payment_method, order.carrier, order.service_type,
      JSON.stringify(order.line_items || []), [order.canonical_product_key].filter(Boolean),
      JSON.stringify(order.product_display_names || []),
      order.normalized_address_hash, order.shipping_address_ciphertext, order.address_line_2_present === true, order.created_at,
      order.updated_at, order.confirmed_at, order.delivered_at, order.source_system,
      order.source_version, order.schema_version, order.observed_at, order.payload_hash,
      order.data_freshness, order.historical_pre_cutover === true
    ]);
    await this.pool.query(`INSERT INTO read_models.operations_order_records
      (canonical_order_id,dropea_order_id,external_order_id_hash,status,sub_status,canonical_state,
       product_summary,total_amount,currency,carrier,service_type,tracking_reference_masked,
       identity_status,decision_status,risk,priority,freshness,latest_message_at,updated_at,
       source_version,schema_version,lifecycle_classification,phone_last4,canonical_product_key,
       duplicate_status,conflicting_order_id,automatic_confirmation_allowed,test_order,
       chatby_cleanup_status,chatby_cleanup_blockers,return_block_status,return_block_reason,
       protection_review,protection_last_reconciled_at,actions_executed,production_writes,run_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
       $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,0,0,'SHADOW_READ_ONLY')
      ON CONFLICT(canonical_order_id) DO UPDATE SET
       dropea_order_id=EXCLUDED.dropea_order_id,external_order_id_hash=EXCLUDED.external_order_id_hash,
       status=EXCLUDED.status,sub_status=EXCLUDED.sub_status,canonical_state=EXCLUDED.canonical_state,
       product_summary=EXCLUDED.product_summary,total_amount=EXCLUDED.total_amount,currency=EXCLUDED.currency,
       carrier=EXCLUDED.carrier,service_type=EXCLUDED.service_type,
       tracking_reference_masked=EXCLUDED.tracking_reference_masked,identity_status=EXCLUDED.identity_status,
       freshness=EXCLUDED.freshness,updated_at=EXCLUDED.updated_at,source_version=EXCLUDED.source_version,
       schema_version=EXCLUDED.schema_version,lifecycle_classification=EXCLUDED.lifecycle_classification,
       phone_last4=EXCLUDED.phone_last4,canonical_product_key=EXCLUDED.canonical_product_key,
       duplicate_status=EXCLUDED.duplicate_status,conflicting_order_id=EXCLUDED.conflicting_order_id,
       automatic_confirmation_allowed=EXCLUDED.automatic_confirmation_allowed,test_order=EXCLUDED.test_order,
       chatby_cleanup_status=EXCLUDED.chatby_cleanup_status,chatby_cleanup_blockers=EXCLUDED.chatby_cleanup_blockers,
       return_block_status=EXCLUDED.return_block_status,return_block_reason=EXCLUDED.return_block_reason,
       protection_review=EXCLUDED.protection_review,
       protection_last_reconciled_at=EXCLUDED.protection_last_reconciled_at`, [
      order.canonical_order_id, order.dropea_order_id, order.external_order_id_hash,
      order.status, order.sub_status, order.canonical_state, order.product_summary,
      order.total_amount, order.currency, order.carrier, order.service_type,
      order.tracking_reference_masked, order.identity_status,
      order.decision_status || 'NOT_ASSESSED', order.risk || 'NOT_ASSESSED',
      order.priority || 'NORMAL', order.data_freshness || 'UNKNOWN',
      order.latest_message_at || null, order.updated_at, order.source_version, order.schema_version,
      order.lifecycle_classification || 'UNKNOWN', order.phone_last4 || null,
      order.canonical_product_key || null, order.duplicate_status || 'NOT_ASSESSED',
      order.conflicting_order_id || null, order.automatic_confirmation_allowed === true,
      order.test_order === true, order.chatby_cleanup_status || 'NOT_ASSESSED',
      order.chatby_cleanup_blockers || [], order.return_block_status || 'NOT_ELIGIBLE',
      order.return_block_reason || null, order.protection_review === true,
      order.protection_last_reconciled_at || null
    ]);
    await this.pool.query(`UPDATE read_models.operations_order_records SET market=$2,store_id=$3,
      product_display_names=$4,normalized_address_hash=$5,address_line_2_present=$6,
      source_system=$7,payload_hash=$8,conversation_source='UNAVAILABLE',
      interpretation_status='WAITING_CHATBY_SOURCE' WHERE canonical_order_id=$1`, [
      order.canonical_order_id, order.market, String(order.store_id), JSON.stringify(order.product_display_names || []),
      order.normalized_address_hash, order.address_line_2_present === true, order.source_system,
      order.payload_hash
    ]);
    await this.pool.query(`INSERT INTO read_models.operations_timeline_records
      (timeline_id,canonical_order_id,event_type,source,occurred_at,summary_masked,freshness)
      VALUES($1,$2,'DROPEA_ORDER_OBSERVED','DROPEA_PUBLIC_API_V2',$3,$4,$5)
      ON CONFLICT(timeline_id) DO NOTHING`, [
      `dropea-order-${order.payload_hash}`, order.canonical_order_id, order.updated_at,
      { status: order.status, sub_status: order.sub_status, market: order.market, store_id: String(order.store_id) },
      order.data_freshness || 'UNKNOWN'
    ]);
    return { projected: true, inserted: integrationResult?.rows?.[0]?.inserted === true, resource: 'order', shadow_mirror_writes: 1, actions_executed: 0, production_writes: 0 };
  }

  async upsertIssue(issue) {
    assertSafe(issue);
    const integrationResult = await this.pool.query(`/* SHADOW_READ_ONLY */ INSERT INTO integration.dropea_issues
      (market,store_id,dropea_issue_id,canonical_issue_id,canonical_order_id,dropea_order_id,
       carrier,canonical_type,secondary_type,raw_type,status,is_active,initial_carrier_code,
       initial_carrier_description_sanitized,initial_carrier_substatus_code,allowed_resolution_options,
       capability_status,resolution_status,pickup_point_masked,delivery_attempt_number,created_at_utc,
       updated_at_utc,source_event_id,source_version,observed_at,payload_hash,data_freshness,
       human_review,automation_allowed)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,false)
      ON CONFLICT(market,store_id,dropea_issue_id) DO UPDATE SET
       canonical_issue_id=EXCLUDED.canonical_issue_id,canonical_order_id=EXCLUDED.canonical_order_id,
       dropea_order_id=EXCLUDED.dropea_order_id,carrier=EXCLUDED.carrier,
       canonical_type=EXCLUDED.canonical_type,secondary_type=EXCLUDED.secondary_type,
       raw_type=EXCLUDED.raw_type,status=EXCLUDED.status,is_active=EXCLUDED.is_active,
       initial_carrier_code=EXCLUDED.initial_carrier_code,
       initial_carrier_description_sanitized=EXCLUDED.initial_carrier_description_sanitized,
       initial_carrier_substatus_code=EXCLUDED.initial_carrier_substatus_code,
       allowed_resolution_options=EXCLUDED.allowed_resolution_options,
       capability_status=EXCLUDED.capability_status,resolution_status=EXCLUDED.resolution_status,
       pickup_point_masked=EXCLUDED.pickup_point_masked,delivery_attempt_number=EXCLUDED.delivery_attempt_number,
       updated_at_utc=EXCLUDED.updated_at_utc,source_event_id=EXCLUDED.source_event_id,
       source_version=EXCLUDED.source_version,observed_at=EXCLUDED.observed_at,
       payload_hash=EXCLUDED.payload_hash,data_freshness=EXCLUDED.data_freshness,
       human_review=EXCLUDED.human_review,last_seen_at=now(),
       shadow_mirror_writes=integration.dropea_issues.shadow_mirror_writes+1
      RETURNING (xmax = 0) AS inserted`, [
      issue.market, String(issue.store_id), issue.dropea_issue_id, issue.canonical_issue_id,
      issue.canonical_order_id, issue.dropea_order_id, issue.carrier, issue.type,
      issue.secondary_type || 'UNKNOWN', issue.raw_type, issue.status, issue.is_active,
      issue.initial_carrier_code, issue.initial_carrier_description_sanitized,
      issue.initial_carrier_substatus_code, issue.allowed_resolution_options,
      issue.capability_status || 'NOT_DECLARED', issue.resolution_status, issue.pickup_point,
      issue.delivery_attempt_number || 'UNKNOWN', issue.created_at, issue.updated_at,
      issue.source_event_id, issue.source_version, issue.observed_at, issue.payload_hash,
      issue.freshness || 'UNKNOWN', issue.human_review === true
    ]);
    if (issue.initial_carrier_code) {
      await this.pool.query(`INSERT INTO integration.carrier_issue_code_registry
        (carrier,market,code,normalized_type,description_example_sanitized,first_seen_at,last_seen_at,
         occurrences,mapping_status,policy_id,human_review)
        VALUES($1,$2,$3,$4,$5,$6,$6,1,$7,$8,$9)
        ON CONFLICT(carrier,market,code) DO UPDATE SET
         normalized_type=EXCLUDED.normalized_type,
         description_example_sanitized=COALESCE(EXCLUDED.description_example_sanitized,
           integration.carrier_issue_code_registry.description_example_sanitized),
         last_seen_at=GREATEST(integration.carrier_issue_code_registry.last_seen_at,EXCLUDED.last_seen_at),
         occurrences=(SELECT count(*) FROM integration.dropea_issues
           WHERE carrier=$1 AND market=$2 AND initial_carrier_code=$3),
         mapping_status=EXCLUDED.mapping_status,policy_id=EXCLUDED.policy_id,
         human_review=EXCLUDED.human_review,updated_at=now()`, [
        issue.carrier, issue.market, issue.initial_carrier_code, issue.type,
        issue.initial_carrier_description_sanitized, issue.observed_at,
        issue.mapping_status || 'UNMAPPED', issue.policy_id, issue.human_review === true
      ]);
    }
    await this.pool.query(`INSERT INTO read_models.operations_incident_records
      (canonical_issue_id,dropea_issue_id,canonical_order_id,dropea_order_id,type,raw_type,
       mapping_status,schema_drift_alert,status,is_active,
       actionable,carrier,tracking_reference_masked,initial_carrier_code,
       initial_carrier_description_sanitized,initial_carrier_substatus_code,
       allowed_resolution_options,pickup_point_masked,delivery_attempt_number,
       carrier_retention_deadline,customer_response_status,customer_intent,proposed_resolution,
       decision_id,policy_id,confidence,risk,priority,qa_result,blocking_reasons,due_at,
       discount_status,freshness,resolution_status,resolution_data_present,resolution_changed_at,
       resolved_at,source_event_id,observed_at,created_at,updated_at,
       actions_executed,production_writes,run_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
       0,0,'SHADOW_READ_ONLY')
      ON CONFLICT(canonical_issue_id) DO UPDATE SET
       type=EXCLUDED.type,raw_type=EXCLUDED.raw_type,mapping_status=EXCLUDED.mapping_status,
       schema_drift_alert=EXCLUDED.schema_drift_alert,status=EXCLUDED.status,
       is_active=EXCLUDED.is_active,actionable=EXCLUDED.actionable,
       allowed_resolution_options=EXCLUDED.allowed_resolution_options,pickup_point_masked=EXCLUDED.pickup_point_masked,
       delivery_attempt_number=EXCLUDED.delivery_attempt_number,carrier_retention_deadline=EXCLUDED.carrier_retention_deadline,
       customer_response_status=EXCLUDED.customer_response_status,customer_intent=EXCLUDED.customer_intent,
       proposed_resolution=EXCLUDED.proposed_resolution,decision_id=EXCLUDED.decision_id,
       policy_id=EXCLUDED.policy_id,confidence=EXCLUDED.confidence,risk=EXCLUDED.risk,
       priority=EXCLUDED.priority,qa_result=EXCLUDED.qa_result,blocking_reasons=EXCLUDED.blocking_reasons,
       due_at=EXCLUDED.due_at,discount_status=EXCLUDED.discount_status,freshness=EXCLUDED.freshness,
       resolution_status=EXCLUDED.resolution_status,
       resolution_data_present=EXCLUDED.resolution_data_present,
       resolution_changed_at=EXCLUDED.resolution_changed_at,resolved_at=EXCLUDED.resolved_at,
       source_event_id=EXCLUDED.source_event_id,observed_at=EXCLUDED.observed_at,
       updated_at=EXCLUDED.updated_at`, [
      issue.canonical_issue_id, issue.dropea_issue_id, issue.canonical_order_id, issue.dropea_order_id,
      issue.type, issue.raw_type || issue.type, issue.mapping_status || 'MAPPED',
      issue.schema_drift_alert === true, issue.status, issue.is_active, issue.actionable, issue.carrier,
      issue.tracking_reference_masked, issue.initial_carrier_code,
      issue.initial_carrier_description_sanitized, issue.initial_carrier_substatus_code,
      issue.allowed_resolution_options, issue.pickup_point, issue.delivery_attempt_number || 'UNKNOWN',
      issue.carrier_retention_deadline, issue.customer_response_status || 'UNKNOWN',
      issue.customer_intent || 'UNKNOWN', issue.proposed_resolution, issue.decision_id,
      issue.policy_id, issue.confidence === null || issue.confidence === undefined ? null : Number(issue.confidence) / 100,
      issue.risk || 'NOT_ASSESSED', issue.priority || 'NORMAL', issue.qa_result || 'PENDING',
      issue.blocking_reasons || [], issue.due_at, issue.discount_status || 'NOT_OFFERED',
      issue.freshness || 'UNKNOWN', issue.resolution_status,
      issue.resolution_data_present === true, issue.resolution_changed_at, issue.resolved_at,
      issue.source_event_id, issue.observed_at, issue.created_at, issue.updated_at
    ]);
    await this.pool.query(`UPDATE read_models.operations_incident_records SET market=$2,store_id=$3,
      secondary_type=$4,capability_status=$5,human_review=$6,automation_allowed=false,
      payload_hash=$7,conversation_source='UNAVAILABLE',interpretation_status='WAITING_CHATBY_SOURCE'
      WHERE canonical_issue_id=$1`, [
      issue.canonical_issue_id, issue.market, String(issue.store_id), issue.secondary_type || 'UNKNOWN',
      issue.capability_status || 'NOT_DECLARED', issue.human_review === true, issue.payload_hash
    ]);
    await this.pool.query(`INSERT INTO read_models.operations_timeline_records
      (timeline_id,canonical_order_id,canonical_issue_id,event_type,source,occurred_at,summary_masked,freshness)
      VALUES($1,$2,$3,'DROPEA_INCIDENT_OBSERVED','DROPEA_PUBLIC_API_V2',$4,$5,$6)
      ON CONFLICT(timeline_id) DO NOTHING`, [
      `dropea-issue-${issue.payload_hash}`, issue.canonical_order_id, issue.canonical_issue_id,
      issue.updated_at, { status: issue.status, is_active: issue.is_active,
        initial_carrier_code: issue.initial_carrier_code, capability_status: issue.capability_status },
      issue.freshness || 'UNKNOWN'
    ]);
    return { projected: true, inserted: integrationResult?.rows?.[0]?.inserted === true, resource: 'issue', shadow_mirror_writes: 1, actions_executed: 0, production_writes: 0 };
  }

  async syncCheckpoint(record) {
    assertSafe(record);
    await this.pool.query(`INSERT INTO integration.dropea_sync_checkpoints
      (market,store_id,resource_type,phase,page,requested_limit,records_read,
       records_inserted_to_shadow,records_updated_in_shadow,duplicates_skipped,errors,
       checkpoint_masked,sync_started_at,sync_completed_at,source_updated_at,freshness,
       pagination_complete,last_error_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(market,store_id,resource_type,phase) DO UPDATE SET
       page=EXCLUDED.page,requested_limit=EXCLUDED.requested_limit,records_read=EXCLUDED.records_read,
       records_inserted_to_shadow=EXCLUDED.records_inserted_to_shadow,
       records_updated_in_shadow=EXCLUDED.records_updated_in_shadow,
       duplicates_skipped=EXCLUDED.duplicates_skipped,errors=EXCLUDED.errors,
       checkpoint_masked=EXCLUDED.checkpoint_masked,sync_started_at=EXCLUDED.sync_started_at,
       sync_completed_at=EXCLUDED.sync_completed_at,source_updated_at=EXCLUDED.source_updated_at,
       freshness=EXCLUDED.freshness,pagination_complete=EXCLUDED.pagination_complete,
       last_error_code=EXCLUDED.last_error_code,updated_at=now()`, [
      record.market, String(record.store_id), record.resource_type, record.phase,
      record.page || null, record.requested_limit || 100, record.records_read || 0,
      record.records_inserted_to_shadow || 0, record.records_updated_in_shadow || 0,
      record.duplicates_skipped || 0, record.errors || 0, record.checkpoint_masked || {},
      record.sync_started_at || null, record.sync_completed_at || null,
      record.source_updated_at || null, record.freshness || 'UNKNOWN',
      record.pagination_complete === true, record.last_error_code || null
    ]);
    return { projected: true, resource: 'sync_checkpoint', actions_executed: 0, production_writes: 0 };
  }

  async recordDropeaWebhook(event) {
    assertSafe(event);
    const result = await this.pool.query(`/* SHADOW_READ_ONLY */ INSERT INTO integration.dropea_webhook_events
      (event_id,topic,market,store_id,resource_id,payload_hash,auth_status,event_at,late_event)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(event_id) DO NOTHING RETURNING event_id`, [
      event.event_id, event.topic, event.market, String(event.store_id), event.resource_id,
      event.payload_hash, event.auth_status, event.event_at, event.late_event === true
    ]);
    return { inserted: (result?.rowCount || 0) > 0, process_async: (result?.rowCount || 0) > 0,
      actions_executed: 0, production_writes: 0 };
  }

  async upsertIncidentInterpretation(record) {
    assertSafe(record);
    await this.pool.query(`INSERT INTO read_models.operations_incident_interpretations
      (canonical_issue_id,canonical_order_id,issue_version,has_customer_replied,
       latest_inbound_message_at,latest_relevant_message_hash,customer_intent,previous_intents,
       intent_changed,contradiction,requested_date,requested_time_window,requested_detail_masked,
       requested_address_present,pickup_requested,return_requested,discount_accepted,discount_rejected,
       conversation_quality,interpretation_confidence,interpretation_summary,messages_used,
       messages_ignored,missing_information,freshness,updated_at,actions_executed,production_writes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,0,0)
      ON CONFLICT(canonical_issue_id) DO UPDATE SET
       canonical_order_id=EXCLUDED.canonical_order_id,issue_version=EXCLUDED.issue_version,
       has_customer_replied=EXCLUDED.has_customer_replied,
       latest_inbound_message_at=EXCLUDED.latest_inbound_message_at,
       latest_relevant_message_hash=EXCLUDED.latest_relevant_message_hash,
       customer_intent=EXCLUDED.customer_intent,previous_intents=EXCLUDED.previous_intents,
       intent_changed=EXCLUDED.intent_changed,contradiction=EXCLUDED.contradiction,
       requested_date=EXCLUDED.requested_date,requested_time_window=EXCLUDED.requested_time_window,
       requested_detail_masked=EXCLUDED.requested_detail_masked,
       requested_address_present=EXCLUDED.requested_address_present,
       pickup_requested=EXCLUDED.pickup_requested,return_requested=EXCLUDED.return_requested,
       discount_accepted=EXCLUDED.discount_accepted,discount_rejected=EXCLUDED.discount_rejected,
       conversation_quality=EXCLUDED.conversation_quality,
       interpretation_confidence=EXCLUDED.interpretation_confidence,
       interpretation_summary=EXCLUDED.interpretation_summary,messages_used=EXCLUDED.messages_used,
       messages_ignored=EXCLUDED.messages_ignored,missing_information=EXCLUDED.missing_information,
       freshness=EXCLUDED.freshness,updated_at=EXCLUDED.updated_at`, [
      record.canonical_issue_id, record.canonical_order_id, record.issue_version,
      record.has_customer_replied, record.latest_inbound_message_at,
      record.latest_relevant_message_hash, record.customer_intent, record.previous_intents,
      record.intent_changed, record.contradiction, record.requested_date,
      record.requested_time_window, record.requested_detail, record.requested_address_present,
      record.pickup_requested, record.return_requested, record.discount_accepted,
      record.discount_rejected, record.conversation_quality, record.interpretation_confidence,
      record.interpretation_summary, record.messages_used, record.messages_ignored,
      record.missing_information, record.freshness || 'UNKNOWN', record.interpreted_at
    ]);
    return { projected: true, resource: 'incident_interpretation', actions_executed: 0, production_writes: 0 };
  }

  async recordIncidentSimulation(record) {
    assertSafe(record);
    await this.pool.query(`INSERT INTO operations.incident_simulation_decisions
      (simulation_id,canonical_issue_id,canonical_order_id,issue_version,source_event_id,
       dropea_snapshot_at,chatby_snapshot_at,policy_version,connector_version,issue_type,
       delivery_attempt_number,customer_has_replied,customer_intent,interpretation_summary,
       facts_used,facts_ignored,allowed_resolution_options,gls_feasibility,simulated_decision,
       simulated_action,missing_data,blocking_reasons,risk,confidence,qa_status,human_review,
       timer_status,execution_available,external_write_attempted,actions_executed,production_writes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,false,false,0,0)
      ON CONFLICT(canonical_issue_id,issue_version,source_event_id,policy_version) DO NOTHING`, [
      record.simulation_id, record.canonical_issue_id, record.canonical_order_id,
      record.issue_version, record.source_event_id, record.dropea_snapshot_at,
      record.chatby_snapshot_at, record.policy_version, record.connector_version,
      record.issue_type, record.delivery_attempt_number || 'UNKNOWN',
      record.customer_has_replied, record.customer_intent, record.interpretation_summary,
      record.facts_used || [], record.facts_ignored || [], record.allowed_resolution_options || [],
      record.gls_feasibility || {}, record.simulated_decision, record.simulated_action,
      record.missing_data || [], record.blocking_reasons || [], record.risk,
      record.confidence, record.qa_status, record.human_review,
      record.timer_status || null
    ]);
    return { projected: true, resource: 'incident_simulation', actions_executed: 0, production_writes: 0 };
  }

  async applyIncidentDecision({ issue, interpretation, decision }) {
    assertSafe({ issue, interpretation, decision });
    await this.pool.query(`INSERT INTO read_models.operations_decision_cards
      (decision_id,canonical_order_id,canonical_issue_id,proposal,payload_masked,policy_version,
       reason_codes,dropea_validation,gls_feasibility,risk,confidence,qa_result,
       requires_human_review,blocking_reasons,created_at,actions_executed,run_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,'SHADOW_READ_ONLY')
      ON CONFLICT(decision_id) DO NOTHING`, [
      decision.decision_id, issue.canonical_order_id, issue.canonical_issue_id,
      decision.simulated_decision, decision.simulated_action,
      decision.policy_version, decision.policy_ids || [],
      decision.proposed_resolution_allowed ? 'ALLOWED' : 'BLOCKED',
      decision.gls_feasibility?.feasible ? 'FEASIBLE_NOT_GUARANTEED' : 'BLOCKED_OR_REVIEW',
      decision.risk, interpretation.interpretation_confidence,
      decision.qa_result, decision.requires_human_review,
      decision.blocking_reasons || [], new Date().toISOString()
    ]);
    await this.pool.query(`UPDATE read_models.operations_incident_records SET
      customer_response_status=$2,customer_intent=$3,proposed_resolution=$4,decision_id=$5,
      policy_id=$6,confidence=$7,risk=$8,priority=$9,qa_result=$10,blocking_reasons=$11,
      due_at=$12,discount_status=$13,updated_at=$14
      WHERE canonical_issue_id=$1`, [
      issue.canonical_issue_id, interpretation.has_customer_replied ? 'RESPONDED' : 'NO_RESPONSE',
      interpretation.customer_intent, decision.proposed_resolution, decision.decision_id,
      decision.policy_version, interpretation.interpretation_confidence,
      decision.risk, decision.risk === 'CRITICAL' ? 'CRITICAL' : decision.risk === 'HIGH' ? 'HIGH' : 'NORMAL',
      decision.qa_result, decision.blocking_reasons || [], decision.timer?.due_at || null,
      decision.discount?.status || 'NOT_OFFERED', issue.updated_at
    ]);
    if (decision.timer) {
      await this.pool.query(`INSERT INTO operations.incident_timers
        (timer_id,canonical_order_id,canonical_issue_id,issue_version,source_event_id,timer_type,
         started_at,due_at,status,policy_version,superseded_by,actions_executed,production_writes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0)
        ON CONFLICT(canonical_issue_id,issue_version,timer_type,source_event_id) DO NOTHING`, [
        decision.timer.timer_id, issue.canonical_order_id, issue.canonical_issue_id,
        issue.updated_at, issue.source_event_id || `poll:${issue.canonical_issue_id}:${issue.updated_at}`,
        decision.timer.timer_type, decision.timer.started_at, decision.timer.due_at,
        decision.timer.status, decision.timer.policy_version, decision.timer.superseded_by
      ]);
    }
    if (decision.discount) {
      await this.pool.query(`INSERT INTO operations.incident_discount_workflow
        (canonical_issue_id,canonical_order_id,status,eligible_at,offer_prepared_at,
         discount_amount,policy_version,actions_executed,production_writes)
        VALUES($1,$2,$3,$4,$5,$6,$7,0,0)
        ON CONFLICT(canonical_issue_id) DO UPDATE SET status=EXCLUDED.status,
         eligible_at=EXCLUDED.eligible_at,offer_prepared_at=EXCLUDED.offer_prepared_at,
         discount_amount=EXCLUDED.discount_amount,updated_at=now()`, [
        issue.canonical_issue_id, issue.canonical_order_id, decision.discount.status,
        decision.discount.created_at, decision.discount.created_at,
        decision.discount.discount_amount, decision.discount.policy_version
      ]);
    }
    return { projected: true, resource: 'incident_decision', actions_executed: 0, production_writes: 0 };
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
