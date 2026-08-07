BEGIN;

CREATE TABLE IF NOT EXISTS operations.chatby_conversation_links (
  canonical_issue_id text PRIMARY KEY,
  canonical_order_id text NOT NULL,
  chatby_conversation_id_hash text,
  chatby_contact_id_hash text,
  conversation_status text NOT NULL CHECK (conversation_status IN ('NONE','FOUND','MULTIPLE','STALE','BROKEN','UNKNOWN')),
  reason_code text NOT NULL,
  identity_method text NOT NULL,
  evidence_hash text,
  last_customer_message_at timestamptz,
  last_suleia_message_at timestamptz,
  last_button text,
  latest_template_hash text,
  customer_replied boolean NOT NULL DEFAULT false,
  conversation_age_seconds bigint,
  conversation_freshness text NOT NULL DEFAULT 'UNKNOWN' CHECK (conversation_freshness IN ('FRESH','STALE','UNKNOWN')),
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  CHECK (conversation_status <> 'FOUND' OR chatby_conversation_id_hash IS NOT NULL),
  CHECK (conversation_status <> 'FOUND' OR evidence_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS chatby_links_order_idx
  ON operations.chatby_conversation_links(canonical_order_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS chatby_links_status_idx
  ON operations.chatby_conversation_links(conversation_status, conversation_freshness, observed_at DESC);

CREATE OR REPLACE VIEW read_models.operations_chatby_conversation_coverage AS
SELECT
  count(*)::integer AS active_incidents,
  count(*) FILTER (WHERE l.conversation_status='FOUND')::integer AS with_conversation,
  count(*) FILTER (WHERE l.conversation_status='NONE')::integer AS without_conversation,
  count(*) FILTER (WHERE l.conversation_status='MULTIPLE')::integer AS multiple_conversations,
  count(*) FILTER (WHERE l.conversation_status='STALE' OR l.conversation_freshness='STALE')::integer AS stale_conversations,
  count(*) FILTER (WHERE l.conversation_status='BROKEN')::integer AS broken_conversations,
  count(*) FILTER (WHERE l.conversation_status IS NULL OR l.conversation_status='UNKNOWN')::integer AS unknown_conversations,
  CASE WHEN count(*)=0 THEN 100::numeric
       ELSE round(100.0 * count(*) FILTER (WHERE l.conversation_status='FOUND') / count(*), 2) END AS coverage_percent,
  max(l.observed_at) AS last_checked_at,
  0::integer AS actions_executed,
  0::integer AS production_writes
FROM read_models.operations_incident_records i
LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
WHERE i.status='PENDING' AND i.is_active=true;

CREATE OR REPLACE VIEW read_models.operations_orders_queue AS
SELECT o.canonical_order_id,o.dropea_order_id,o.status,o.sub_status,o.canonical_state,
       o.product_summary,o.total_amount,o.currency,o.carrier,o.tracking_reference_masked,
       o.identity_status,o.decision_status,o.risk,o.priority,o.freshness,o.latest_message_at,
       o.updated_at,o.actions_executed,o.production_writes,o.run_mode,
       o.lifecycle_classification,o.phone_last4,o.canonical_product_key,o.duplicate_status,
       o.conflicting_order_id,o.automatic_confirmation_allowed,o.test_order,
       o.chatby_cleanup_status,o.chatby_cleanup_blockers,o.return_block_status,
       o.return_block_reason,o.protection_review,o.protection_last_reconciled_at,
       coalesce(c.conversation_status,'UNKNOWN') AS conversation_status,
       coalesce(c.conversation_freshness,'UNKNOWN') AS conversation_freshness
FROM read_models.operations_order_records o
LEFT JOIN LATERAL (
  SELECT conversation_status,conversation_freshness
  FROM operations.chatby_conversation_links l
  WHERE l.canonical_order_id=o.canonical_order_id
  ORDER BY l.observed_at DESC LIMIT 1
) c ON true;

CREATE OR REPLACE VIEW read_models.operations_order_detail AS
SELECT o.canonical_order_id,o.dropea_order_id,o.external_order_id_hash,o.status,o.sub_status,
       o.canonical_state,o.product_summary,o.total_amount,o.currency,o.carrier,o.service_type,
       o.tracking_reference_masked,o.identity_status,o.decision_status,o.risk,o.priority,
       o.freshness,o.latest_message_at,o.updated_at,o.source_version,o.schema_version,
       o.actions_executed,o.production_writes,o.run_mode,o.lifecycle_classification,
       o.phone_last4,o.canonical_product_key,o.duplicate_status,o.conflicting_order_id,
       o.automatic_confirmation_allowed,o.test_order,o.chatby_cleanup_status,
       o.chatby_cleanup_blockers,o.return_block_status,o.return_block_reason,
       o.protection_review,o.protection_last_reconciled_at,
       c.has_customer_replied, c.latest_inbound_message_at,
       c.latest_relevant_message_hash, c.detected_intent, c.requested_date,
       c.requested_time_window, c.address_change_detected, c.refusal_detected,
       c.acceptance_detected, c.discount_accepted, c.change_of_intent,
       c.contradiction, c.confidence AS conversation_confidence,
       c.messages_used, c.messages_ignored, c.explanation_masked,
       coalesce(l.conversation_status,'UNKNOWN') AS conversation_status,
       l.reason_code AS conversation_reason,l.identity_method AS conversation_identity_method,
       l.last_customer_message_at,l.last_suleia_message_at,l.last_button,
       l.latest_template_hash,l.customer_replied,l.conversation_age_seconds,
       coalesce(l.conversation_freshness,'UNKNOWN') AS conversation_freshness,
       coalesce(l.message_count,0) AS conversation_message_count,l.observed_at AS conversation_observed_at
FROM read_models.operations_order_records o
LEFT JOIN read_models.operations_conversation_summaries c USING (canonical_order_id)
LEFT JOIN LATERAL (
  SELECT * FROM operations.chatby_conversation_links x
  WHERE x.canonical_order_id=o.canonical_order_id ORDER BY x.observed_at DESC LIMIT 1
) l ON true;

CREATE OR REPLACE VIEW read_models.operations_incidents_queue AS
SELECT i.canonical_issue_id,i.dropea_issue_id,i.canonical_order_id,i.dropea_order_id,
       i.type,i.status,i.is_active,i.actionable,i.carrier,i.tracking_reference_masked,
       i.allowed_resolution_options,i.delivery_attempt_number,i.carrier_retention_deadline,
       i.customer_response_status,i.customer_intent,i.proposed_resolution,i.decision_id,
       i.risk,i.priority,i.qa_result,i.blocking_reasons,i.due_at,i.discount_status,
       i.freshness,i.created_at,i.updated_at,i.actions_executed,i.production_writes,i.run_mode,
       coalesce(l.conversation_status,'UNKNOWN') AS conversation_status,
       l.reason_code AS conversation_reason,
       coalesce(l.conversation_freshness,'UNKNOWN') AS conversation_freshness
FROM read_models.operations_incident_records i
LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
WHERE i.status='PENDING' AND i.is_active=true;

CREATE OR REPLACE VIEW read_models.operations_incident_handbook_detail AS
SELECT i.canonical_issue_id,i.dropea_issue_id,i.canonical_order_id,i.dropea_order_id,
       i.type,i.status,i.is_active,i.actionable,i.carrier,i.tracking_reference_masked,
       i.initial_carrier_code,i.initial_carrier_description_sanitized,
       i.initial_carrier_substatus_code,i.allowed_resolution_options,i.pickup_point_masked,
       i.delivery_attempt_number,i.carrier_retention_deadline,i.customer_response_status,
       i.customer_intent,i.proposed_resolution,i.decision_id,i.policy_id,i.confidence,
       i.risk,i.priority,i.qa_result,i.blocking_reasons,i.due_at,i.discount_status,
       i.freshness,i.created_at,i.updated_at,i.actions_executed,i.production_writes,i.run_mode,
       i.raw_type,i.mapping_status,i.schema_drift_alert,i.resolution_status,
       i.resolution_data_present,i.resolution_changed_at,i.resolved_at,i.source_event_id,i.observed_at,
       x.has_customer_replied, x.latest_inbound_message_at,
       x.latest_relevant_message_hash, x.customer_intent AS detected_intent,
       x.previous_intents, x.intent_changed, x.contradiction,
       x.requested_date, x.requested_time_window, x.requested_detail_masked,
       x.requested_address_present, x.pickup_requested, x.return_requested,
       x.discount_accepted, x.discount_rejected, x.conversation_quality,
       x.interpretation_confidence AS conversation_confidence,
       x.interpretation_summary, x.messages_used, x.messages_ignored,x.missing_information,
       d.payload_masked AS decision_payload_masked,d.policy_version AS decision_policy_version,
       d.reason_codes,d.dropea_validation,d.gls_feasibility,
       d.confidence AS decision_confidence,d.requires_human_review,
       w.original_amount,w.discount_amount,w.new_amount,w.offer_created_at,
       w.response_status AS discount_response_status,w.accepted_at AS discount_accepted_at,
       w.email_prepared,w.email_sent,w.dropea_status AS discount_dropea_status,
       w.cod_change_verified,w.ready_for_retry,
       coalesce(l.conversation_status,'UNKNOWN') AS conversation_status,
       l.reason_code AS conversation_reason,l.identity_method AS conversation_identity_method,
       l.last_customer_message_at,l.last_suleia_message_at,l.last_button,
       l.latest_template_hash,l.customer_replied,l.conversation_age_seconds,
       coalesce(l.conversation_freshness,'UNKNOWN') AS conversation_freshness,
       coalesce(l.message_count,0) AS conversation_message_count,l.observed_at AS conversation_observed_at
FROM read_models.operations_incident_records i
LEFT JOIN read_models.operations_incident_interpretations x USING(canonical_issue_id)
LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
LEFT JOIN read_models.operations_decision_cards d ON d.decision_id=i.decision_id
LEFT JOIN read_models.operations_discount_workflows w ON w.canonical_order_id=i.canonical_order_id;

GRANT SELECT,INSERT,UPDATE ON operations.chatby_conversation_links TO suleia_ingestion;
GRANT SELECT ON operations.chatby_conversation_links TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
GRANT SELECT ON read_models.operations_chatby_conversation_coverage,
  read_models.operations_orders_queue,read_models.operations_order_detail,
  read_models.operations_incidents_queue,read_models.operations_incident_handbook_detail
TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;

COMMIT;
