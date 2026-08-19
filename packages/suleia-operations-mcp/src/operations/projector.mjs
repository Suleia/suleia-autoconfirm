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

  async projectOperationalTruthOrder(order) {
    const customer = order.customer_identity_hash
      ? await this.pool.query(`INSERT INTO core.customers_masked
          (external_reference_hash,masking_version,updated_at)
          VALUES($1,'hmac-sha256-v1',now())
          ON CONFLICT(external_reference_hash) DO UPDATE SET updated_at=now()
          RETURNING id`, [order.customer_identity_hash])
      : { rows: [] };
    const canonical = await this.pool.query(`INSERT INTO core.orders
      (external_order_id,customer_id,source_status,canonical_status,currency,total_amount,
       created_at_source,last_source_update_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
      ON CONFLICT(external_order_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,
       source_status=EXCLUDED.source_status,canonical_status=EXCLUDED.canonical_status,
       currency=EXCLUDED.currency,total_amount=EXCLUDED.total_amount,
       last_source_update_at=EXCLUDED.last_source_update_at,updated_at=now()
      RETURNING id`, [
      order.canonical_order_id, customer.rows?.[0]?.id || null, order.status,
      order.canonical_state, order.currency, order.total_amount, order.created_at, order.updated_at
    ]);
    const coreOrderId = canonical.rows[0].id;
    const primaryLink = order.identity?.links?.find((link) => link.namespace === 'dropea_order_id');
    if (primaryLink?.value_hash) {
      await this.pool.query(`INSERT INTO core.order_source_links
        (order_id,source,source_order_id_hash,confidence,verified_at)
        VALUES($1,'DROPEA_PUBLIC_API_V2',$2,1,now())
        ON CONFLICT(source,source_order_id_hash) DO UPDATE SET
         order_id=EXCLUDED.order_id,confidence=1,verified_at=now()`, [coreOrderId, primaryLink.value_hash]);
    }
    const eventPayload = {
      status: order.status, sub_status: order.sub_status, canonical_state: order.canonical_state,
      total_amount: order.total_amount, currency: order.currency, carrier: order.carrier,
      source_version: order.source_version
    };
    await this.pool.query(`INSERT INTO events.order_events
      (order_id,event_type,occurred_at,source,source_record_id_hash,payload_masked,checksum,
       deduplication_key,trust_level,freshness_status,masking_version,run_mode)
      VALUES($1,'DROPEA_ORDER_OBSERVED',$2,'DROPEA_PUBLIC_API_V2',$3,$4,$3,$5,
       'HIGH',$6,'hmac-sha256-v1','SIMULATION')
      ON CONFLICT(deduplication_key) DO NOTHING`, [
      coreOrderId, order.updated_at, order.payload_hash, JSON.stringify(eventPayload),
      `dropea-order:${order.payload_hash}`, order.data_freshness || 'UNKNOWN'
    ]);
    const twin = {
      canonical_order_id: order.canonical_order_id, status: order.status,
      sub_status: order.sub_status, canonical_state: order.canonical_state,
      total_amount: order.total_amount, currency: order.currency, carrier: order.carrier,
      source: 'DROPEA_PUBLIC_API_V2', source_version: order.source_version,
      observed_at: order.observed_at
    };
    await this.pool.query(`INSERT INTO core.order_digital_twins
      (order_id,snapshot_version,twin_document,completeness,freshness_status,
       contradiction_count,policy_versions,built_at,run_mode)
      VALUES($1,$2,$3,$4,$5,0,'{}',now(),'SIMULATION')
      ON CONFLICT(order_id) DO UPDATE SET snapshot_version=EXCLUDED.snapshot_version,
       twin_document=EXCLUDED.twin_document,completeness=EXCLUDED.completeness,
       freshness_status=EXCLUDED.freshness_status,built_at=now()`, [
      coreOrderId, order.payload_hash, JSON.stringify(twin),
      ['EXACT', 'VERIFIED'].includes(order.identity_status) ? 1 : 0.8,
      order.data_freshness || 'UNKNOWN'
    ]);
    return { core_order_id: coreOrderId, actions_executed: 0, production_writes: 0 };
  }

  async projectOperationalTruthIssue(issue) {
    const canonical = await this.pool.query(`SELECT id FROM core.orders
      WHERE external_order_id=$1 LIMIT 1`, [issue.canonical_order_id]);
    if (!canonical.rows?.[0]?.id) throw new Error('CORE_ORDER_MISSING_FOR_ISSUE');
    const coreOrderId = canonical.rows[0].id;
    await this.pool.query(`INSERT INTO core.incidents
      (order_id,external_incident_id,incident_type,status,opened_at,resolved_at,
       latest_carrier_reason_masked,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now())
      ON CONFLICT(external_incident_id) DO UPDATE SET incident_type=EXCLUDED.incident_type,
       status=EXCLUDED.status,resolved_at=EXCLUDED.resolved_at,
       latest_carrier_reason_masked=EXCLUDED.latest_carrier_reason_masked,updated_at=now()`, [
      coreOrderId, issue.canonical_issue_id, issue.type, issue.status, issue.created_at,
      issue.resolved_at, issue.initial_carrier_description_sanitized
    ]);
    const eventPayload = {
      issue_type: issue.type, status: issue.status, is_active: issue.is_active,
      carrier: issue.carrier, carrier_code: issue.initial_carrier_code,
      mapping_status: issue.mapping_status, source_version: issue.source_version
    };
    await this.pool.query(`INSERT INTO events.order_events
      (order_id,event_type,occurred_at,source,source_record_id_hash,payload_masked,checksum,
       deduplication_key,trust_level,freshness_status,masking_version,run_mode)
      VALUES($1,'DROPEA_ISSUE_OBSERVED',$2,'DROPEA_PUBLIC_API_V2',$3,$4,$3,$5,
       'HIGH',$6,'hmac-sha256-v1','SIMULATION')
      ON CONFLICT(deduplication_key) DO NOTHING`, [
      coreOrderId, issue.updated_at, issue.payload_hash, JSON.stringify(eventPayload),
      `dropea-issue:${issue.payload_hash}`, issue.freshness || 'UNKNOWN'
    ]);
    return { core_order_id: coreOrderId, actions_executed: 0, production_writes: 0 };
  }

  async upsertOrder(order) {
    assertSafe(order);
    const integrationResult = await this.pool.query(`/* SHADOW_READ_ONLY */ INSERT INTO integration.dropea_orders
      (market,store_id,dropea_order_id,canonical_order_id,external_order_id_hash,external_order_id_ciphertext,status,sub_status,
       lifecycle_status,total_amount,currency,payment_method,carrier,service_type,line_items_masked,
       canonical_product_keys,product_display_names,normalized_address_hash,shipping_address_ciphertext,address_line_2_present,
       created_at_utc,updated_at_utc,confirmed_at_utc,processing_at_utc,delivered_at_utc,
       cancelled_at_utc,returned_at_utc,source_system,source_version,
       schema_version,observed_at,payload_hash,data_freshness,historical_pre_cutover,customer_identity_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
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
       processing_at_utc=EXCLUDED.processing_at_utc,delivered_at_utc=EXCLUDED.delivered_at_utc,
       cancelled_at_utc=EXCLUDED.cancelled_at_utc,returned_at_utc=EXCLUDED.returned_at_utc,
       source_system=EXCLUDED.source_system,
       source_version=EXCLUDED.source_version,schema_version=EXCLUDED.schema_version,
       observed_at=EXCLUDED.observed_at,payload_hash=EXCLUDED.payload_hash,
       data_freshness=EXCLUDED.data_freshness,last_seen_at=now(),
       customer_identity_hash=EXCLUDED.customer_identity_hash,
       shadow_mirror_writes=integration.dropea_orders.shadow_mirror_writes+1
      RETURNING (xmax = 0) AS inserted`, [
      order.market, String(order.store_id), order.dropea_order_id, order.canonical_order_id,
      order.external_order_id_hash, order.external_order_id_ciphertext, order.status, order.sub_status, order.canonical_state,
      order.total_amount, order.currency, order.payment_method, order.carrier, order.service_type,
      JSON.stringify(order.line_items || []), [order.canonical_product_key].filter(Boolean),
      JSON.stringify(order.product_display_names || []),
      order.normalized_address_hash, order.shipping_address_ciphertext, order.address_line_2_present === true, order.created_at,
       order.updated_at, order.confirmed_at, order.processing_at, order.delivered_at,
       order.cancelled_at, order.returned_at, order.source_system,
      order.source_version, order.schema_version, order.observed_at, order.payload_hash,
      order.data_freshness, order.historical_pre_cutover === true,
      order.customer_identity_hash || null
    ]);
    await this.pool.query(`INSERT INTO read_models.operations_order_records
      (canonical_order_id,dropea_order_id,external_order_id_hash,status,sub_status,canonical_state,
       product_summary,total_amount,currency,carrier,service_type,tracking_reference_masked,
       identity_status,decision_status,risk,priority,freshness,latest_message_at,updated_at,
       source_version,schema_version,lifecycle_classification,phone_last4,canonical_product_key,
       duplicate_status,conflicting_order_id,automatic_confirmation_allowed,test_order,
       chatby_cleanup_status,chatby_cleanup_blockers,return_block_status,return_block_reason,
       protection_review,protection_last_reconciled_at,customer_identity_hash,
       actions_executed,production_writes,run_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
       $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,0,0,'SHADOW_READ_ONLY')
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
       protection_last_reconciled_at=EXCLUDED.protection_last_reconciled_at,
       customer_identity_hash=EXCLUDED.customer_identity_hash`, [
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
      order.protection_last_reconciled_at || null, order.customer_identity_hash || null
    ]);
    await this.pool.query(`UPDATE read_models.operations_order_records SET market=$2,store_id=$3,
      product_display_names=$4,normalized_address_hash=$5,address_line_2_present=$6,
      source_system=$7,payload_hash=$8 WHERE canonical_order_id=$1`, [
      order.canonical_order_id, order.market, String(order.store_id), JSON.stringify(order.product_display_names || []),
      order.normalized_address_hash, order.address_line_2_present === true, order.source_system,
      order.payload_hash
    ]);
    await this.pool.query(`INSERT INTO read_models.operations_timeline_records
      (timeline_id,canonical_order_id,event_type,source,occurred_at,summary_masked,freshness)
      VALUES($1,$2,'DROPEA_ORDER_OBSERVED','DROPEA_PUBLIC_API_V2',$3,$4,$5)
      ON CONFLICT(timeline_id) DO NOTHING`, [
      `dropea-order-${order.payload_hash}`, order.canonical_order_id, order.updated_at,
       { status: order.status, sub_status: order.sub_status, lifecycle_status: order.canonical_state,
         market: order.market, store_id: String(order.store_id) },
      order.data_freshness || 'UNKNOWN'
    ]);
    await this.projectOperationalTruthOrder(order);
    return { projected: true, inserted: integrationResult?.rows?.[0]?.inserted === true, resource: 'order', shadow_mirror_writes: 1, actions_executed: 0, production_writes: 0 };
  }

  async upsertOperationalOrderSignal(signal) {
    assertSafe(signal);
    await this.pool.query(`INSERT INTO read_models.operations_conversation_summaries
      (canonical_order_id,has_customer_replied,latest_inbound_message_at,
       latest_relevant_message_hash,detected_intent,requested_date,requested_time_window,
       address_change_detected,refusal_detected,acceptance_detected,discount_accepted,
       change_of_intent,contradiction,confidence,messages_used,messages_ignored,
       explanation_masked,freshness,updated_at)
      VALUES($1,$2,$3,NULL,$4,NULL,NULL,$5,$6,$7,false,false,'NONE',$8,$9,0,$10,$11,$12)
      ON CONFLICT(canonical_order_id) DO UPDATE SET
       has_customer_replied=EXCLUDED.has_customer_replied,
       latest_inbound_message_at=EXCLUDED.latest_inbound_message_at,
       detected_intent=EXCLUDED.detected_intent,
       address_change_detected=EXCLUDED.address_change_detected,
       refusal_detected=EXCLUDED.refusal_detected,
       acceptance_detected=EXCLUDED.acceptance_detected,
       confidence=EXCLUDED.confidence,messages_used=EXCLUDED.messages_used,
       explanation_masked=EXCLUDED.explanation_masked,freshness=EXCLUDED.freshness,
       updated_at=EXCLUDED.updated_at`, [
      signal.canonical_order_id, signal.has_customer_replied,
      signal.latest_inbound_message_at, signal.detected_intent,
      signal.detected_intent === 'ADDRESS_CHANGE', signal.detected_intent === 'REJECT',
      signal.detected_intent === 'CONFIRM', signal.confidence,
      signal.messages_used, signal.explanation_masked,
      signal.freshness, signal.updated_at
    ]);
    await this.pool.query(`UPDATE read_models.operations_order_records SET
      conversation_source='CHATBY_VIA_RENDER_READ_MODEL',
      interpretation_status=$2,latest_message_at=$3
      WHERE canonical_order_id=$1`, [
      signal.canonical_order_id,
      signal.detected_intent === 'UNKNOWN' ? 'REVIEW_REQUIRED' : 'INTERPRETED',
      signal.latest_inbound_message_at
    ]);
    return { projected: true, resource: 'operational_order_signal', actions_executed: 0, production_writes: 0 };
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
          occurrences,mapping_status,policy_id,human_review,last_verified_at)
        VALUES($1,$2,$3,$4,$5,$6,$6,1,$7,$8,$9,$10)
        ON CONFLICT(carrier,market,code) DO UPDATE SET
         normalized_type=EXCLUDED.normalized_type,
         description_example_sanitized=COALESCE(EXCLUDED.description_example_sanitized,
           integration.carrier_issue_code_registry.description_example_sanitized),
         last_seen_at=GREATEST(integration.carrier_issue_code_registry.last_seen_at,EXCLUDED.last_seen_at),
         occurrences=(SELECT count(*) FROM integration.dropea_issues
           WHERE carrier=$1 AND market=$2 AND initial_carrier_code=$3),
         mapping_status=EXCLUDED.mapping_status,policy_id=EXCLUDED.policy_id,
          human_review=EXCLUDED.human_review,
          last_verified_at=COALESCE(EXCLUDED.last_verified_at,integration.carrier_issue_code_registry.last_verified_at),
          updated_at=now()`, [
        issue.carrier, issue.market, issue.initial_carrier_code, issue.type,
        issue.initial_carrier_description_sanitized, issue.observed_at,
        issue.mapping_status || 'UNMAPPED', issue.policy_id, issue.human_review === true,
        issue.mapping_status === 'MAPPED' ? issue.observed_at : null
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
      payload_hash=$7
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
         initial_carrier_code: issue.initial_carrier_code, normalized_type: issue.type,
         resolution_status: issue.resolution_status, capability_status: issue.capability_status },
      issue.freshness || 'UNKNOWN'
    ]);
    await this.projectOperationalTruthIssue(issue);
    return { projected: true, inserted: integrationResult?.rows?.[0]?.inserted === true, resource: 'issue', shadow_mirror_writes: 1, actions_executed: 0, production_writes: 0 };
  }

  async reconcilePendingIssues({ market, storeId, activeIssueIds = [], observedAt }) {
    assertSafe({ market, storeId, activeIssueIds, observedAt });
    const ids = activeIssueIds.map(String);
    const result = await this.pool.query(`/* SHADOW_READ_ONLY: authoritative pending snapshot */
      WITH no_longer_pending AS (
        UPDATE integration.dropea_issues
           SET is_active=false,
               resolution_status=COALESCE(resolution_status,'SOURCE_NO_LONGER_PENDING'),
               observed_at=$4::timestamptz,
               data_freshness='CURRENT',
               last_seen_at=now(),
               shadow_mirror_writes=shadow_mirror_writes+1
         WHERE market=$1 AND store_id=$2 AND status='PENDING' AND is_active=true
           AND NOT (dropea_issue_id = ANY($3::text[]))
         RETURNING canonical_issue_id,canonical_order_id
      ), projected AS (
        UPDATE read_models.operations_incident_records r
           SET is_active=false,
               resolution_status=COALESCE(r.resolution_status,'SOURCE_NO_LONGER_PENDING'),
               resolution_changed_at=$4::timestamptz,
               observed_at=$4::timestamptz,
               freshness='CURRENT'
          FROM no_longer_pending n
         WHERE r.canonical_issue_id=n.canonical_issue_id
         RETURNING r.canonical_issue_id,r.canonical_order_id
      ), audited AS (
        INSERT INTO read_models.operations_timeline_records
          (timeline_id,canonical_order_id,canonical_issue_id,event_type,source,occurred_at,summary_masked,freshness)
        SELECT 'dropea-pending-snapshot-' || md5(p.canonical_issue_id || $4::text),
               p.canonical_order_id,p.canonical_issue_id,'DROPEA_INCIDENT_LEFT_PENDING_QUEUE',
               'DROPEA_PUBLIC_API_V2',$4::timestamptz,
               jsonb_build_object('pending_snapshot_present',false,'status_preserved','PENDING'),'CURRENT'
          FROM projected p
        ON CONFLICT(timeline_id) DO NOTHING
        RETURNING canonical_issue_id
      )
      SELECT count(*)::integer AS reconciled FROM projected`,
    [market, String(storeId), ids, observedAt]);
    return {
      projected: true,
      resource: 'pending_issue_reconciliation',
      reconciled: result.rows?.[0]?.reconciled || 0,
      actions_executed: 0,
      production_writes: 0
    };
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

  async recordSourceFreshness({ source, last_success_at, lag_seconds = 0, status = 'FRESH' }) {
    await this.pool.query(`INSERT INTO core.source_freshness
      (source,last_success_at,last_failure_at,lag_seconds,status,checked_at)
      VALUES($1,$2,NULL,$3,$4,now())
      ON CONFLICT(source) DO UPDATE SET last_success_at=EXCLUDED.last_success_at,
       lag_seconds=EXCLUDED.lag_seconds,status=EXCLUDED.status,checked_at=now()`, [
      source, last_success_at, lag_seconds, status
    ]);
    return { projected: true, resource: 'source_freshness', actions_executed: 0, production_writes: 0 };
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

  async recordChatbyConversationEvent(event) {
    assertSafe(event);
    const result = await this.pool.query(`/* SHADOW_READ_ONLY */ INSERT INTO operations.chatby_conversation_events
      (chatby_conversation_id_hash,chatby_contact_id_hash,chatby_message_id_hash,
       canonical_order_id,canonical_issue_id,direction,message_type,template_id_hash,
       button_payload,sanitized_text,occurred_at,source_event_id,incident_version,
       relevance_status,intent,intent_confidence,payload_hash,actions_executed,production_writes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,0,0)
      ON CONFLICT(chatby_message_id_hash,payload_hash) DO NOTHING RETURNING event_id`, [
      event.chatby_conversation_id_hash, event.chatby_contact_id_hash,
      event.chatby_message_id_hash, event.canonical_order_id, event.canonical_issue_id,
      event.direction, event.message_type, event.template_id_hash, event.button_payload,
      event.sanitized_text, event.occurred_at, event.source_event_id,
      event.incident_version, event.relevance_status, event.intent,
      event.intent_confidence, event.payload_hash
    ]);
    if ((result?.rowCount || 0) > 0) {
      await this.pool.query(`INSERT INTO read_models.operations_timeline_records
        (timeline_id,canonical_order_id,canonical_issue_id,event_type,source,occurred_at,
         summary_masked,freshness)
        VALUES($1,$2,$3,$4,'CHATBY_READ_ONLY',$5,$6,$7)
        ON CONFLICT(timeline_id) DO NOTHING`, [
        `chatby:${event.chatby_message_id_hash}`, event.canonical_order_id,
        event.canonical_issue_id, `CHATBY_${event.direction}_${event.message_type}`,
        event.occurred_at, JSON.stringify({
          intent: event.intent, button: event.button_payload,
          relevance_status: event.relevance_status, text_status: event.sanitized_text
        }), event.relevance_status === 'CURRENT_ORDER_EXACT_MATCH' ? 'FRESH' : 'STALE'
      ]);
    }
    return { inserted: (result?.rowCount || 0) > 0, actions_executed: 0, production_writes: 0 };
  }

  async upsertChatbyPrivateMessageDisplay(record) {
    assertSafe(record);
    const result = await this.pool.query(`/* SHADOW_READ_ONLY: encrypted private display only */
      INSERT INTO operations.chatby_private_message_display
        (chatby_message_id_hash,canonical_order_id,canonical_issue_id,direction,message_type,
         intent,relation_to_issue,message_text_ciphertext,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(canonical_issue_id,chatby_message_id_hash) DO UPDATE SET
        direction=EXCLUDED.direction,message_type=EXCLUDED.message_type,intent=EXCLUDED.intent,
        relation_to_issue=EXCLUDED.relation_to_issue,
        message_text_ciphertext=EXCLUDED.message_text_ciphertext,
        occurred_at=EXCLUDED.occurred_at,updated_at=now()
      RETURNING (xmax = 0) AS inserted`, [
      record.chatby_message_id_hash, record.canonical_order_id, record.canonical_issue_id,
      record.direction, record.message_type, record.intent, record.relation_to_issue,
      record.message_text_ciphertext, record.occurred_at
    ]);
    return { inserted: result.rows[0]?.inserted === true, encrypted_private_display: true,
      actions_executed: 0, production_writes: 0 };
  }

  async upsertChatbyConversationLink(record) {
    assertSafe(record);
    await this.pool.query(`/* SHADOW_READ_ONLY */ INSERT INTO operations.chatby_conversation_links
      (canonical_issue_id,canonical_order_id,chatby_conversation_id_hash,chatby_contact_id_hash,
       conversation_status,reason_code,identity_method,evidence_hash,last_customer_message_at,
       last_suleia_message_at,last_button,latest_template_hash,customer_replied,
       conversation_age_seconds,conversation_freshness,message_count,observed_at,
       actions_executed,production_writes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),0,0)
      ON CONFLICT(canonical_issue_id) DO UPDATE SET
       canonical_order_id=EXCLUDED.canonical_order_id,
       chatby_conversation_id_hash=EXCLUDED.chatby_conversation_id_hash,
       chatby_contact_id_hash=EXCLUDED.chatby_contact_id_hash,
       conversation_status=EXCLUDED.conversation_status,reason_code=EXCLUDED.reason_code,
       identity_method=EXCLUDED.identity_method,evidence_hash=EXCLUDED.evidence_hash,
       last_customer_message_at=EXCLUDED.last_customer_message_at,
       last_suleia_message_at=EXCLUDED.last_suleia_message_at,last_button=EXCLUDED.last_button,
       latest_template_hash=EXCLUDED.latest_template_hash,customer_replied=EXCLUDED.customer_replied,
       conversation_age_seconds=EXCLUDED.conversation_age_seconds,
       conversation_freshness=EXCLUDED.conversation_freshness,message_count=EXCLUDED.message_count,
       observed_at=now()`, [
      record.canonical_issue_id, record.canonical_order_id,
      record.chatby_conversation_id_hash || null, record.chatby_contact_id_hash || null,
      record.conversation_status, record.reason_code, record.identity_method,
      record.evidence_hash || null, record.last_customer_message_at || null,
      record.last_suleia_message_at || null, record.last_button || null,
      record.latest_template_hash || null, record.customer_replied === true,
      record.conversation_age_seconds ?? null, record.conversation_freshness || 'UNKNOWN',
      record.message_count || 0
    ]);
    const available = record.conversation_status === 'FOUND';
    await this.pool.query(`UPDATE read_models.operations_order_records SET
      conversation_source=$2,interpretation_status=$3 WHERE canonical_order_id=$1`, [
      record.canonical_order_id, available ? 'AVAILABLE' : 'UNAVAILABLE',
      available ? 'READY' : `CHATBY_${record.conversation_status}`
    ]);
    await this.pool.query(`UPDATE read_models.operations_incident_records SET
      conversation_source=$3,interpretation_status=$4
      WHERE canonical_issue_id=$1 AND canonical_order_id=$2`, [
      record.canonical_issue_id, record.canonical_order_id,
      available ? 'AVAILABLE' : 'UNAVAILABLE', available ? 'READY' : `CHATBY_${record.conversation_status}`
    ]);
    return { linked: available, status: record.conversation_status,
      actions_executed: 0, production_writes: 0 };
  }

  async markChatbyConversationAvailable({ canonical_order_id, canonical_issue_id }) {
    await this.pool.query(`UPDATE read_models.operations_order_records
      SET conversation_source='AVAILABLE',interpretation_status='READY'
      WHERE canonical_order_id=$1`, [canonical_order_id]);
    await this.pool.query(`UPDATE read_models.operations_incident_records
      SET conversation_source='AVAILABLE',interpretation_status='READY'
      WHERE canonical_issue_id=$1 AND canonical_order_id=$2`, [canonical_issue_id, canonical_order_id]);
    return { available: true, actions_executed: 0, production_writes: 0 };
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
      JSON.stringify(record.facts_used || []), JSON.stringify(record.facts_ignored || []),
      record.allowed_resolution_options || [], JSON.stringify(record.gls_feasibility || {}),
      record.simulated_decision,
      record.simulated_action === null || record.simulated_action === undefined
        ? null : JSON.stringify(record.simulated_action),
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
