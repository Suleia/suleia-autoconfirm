BEGIN;

-- Extend the existing Dropea V2 mirror rather than creating another order store.
ALTER TABLE integration.dropea_orders
  ADD COLUMN IF NOT EXISTS processing_at_utc timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at_utc timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at_utc timestamptz;

ALTER TABLE operations.chatby_conversation_links
  ADD COLUMN IF NOT EXISTS conversation_source_version text NOT NULL DEFAULT 'CHATBY_POLL_V1';

ALTER TABLE integration.carrier_issue_code_registry
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

-- EXPLAIN on the real mirror showed repeated order-to-incident scans in both
-- central contexts. This index serves the detail join and historical count.
CREATE INDEX IF NOT EXISTS operations_incidents_order_updated_idx
  ON read_models.operations_incident_records(canonical_order_id,updated_at DESC);

-- One functional order identity. API version remains provenance, never identity.
CREATE OR REPLACE VIEW read_models.order_identity_map AS
SELECT d.canonical_order_id,d.market,d.store_id,d.dropea_order_id,
       d.source_system,d.source_version,
       d.external_order_id_hash AS shopify_external_order_id_hash,
       NULL::text AS chatby_order_reference_hash,
       l.chatby_contact_id_hash AS chatby_contact_hash,
       l.chatby_conversation_id_hash AS chatby_conversation_hash,
       coalesce(l.identity_method,'DROPEA_TECHNICAL_ORDER_ID') AS identity_method,
       r.identity_status,
       CASE r.identity_status WHEN 'EXACT' THEN 1.0000 WHEN 'VERIFIED' THEN 0.9500
         WHEN 'PARTIAL' THEN 0.6000 WHEN 'CONFLICTING' THEN 0.0000 ELSE 0.2500 END::numeric(5,4)
         AS identity_confidence,
       d.first_seen_at,d.last_seen_at,
       CASE WHEN r.identity_status IN ('EXACT','VERIFIED') THEN greatest(d.last_seen_at,l.observed_at) END
         AS last_verified_at,
       d.observed_at,d.data_freshness AS freshness,
       0::integer AS actions_executed,0::integer AS production_writes
FROM integration.dropea_orders d
JOIN read_models.operations_order_records r USING(canonical_order_id)
LEFT JOIN LATERAL (
  SELECT x.chatby_contact_id_hash,x.chatby_conversation_id_hash,x.identity_method,x.observed_at
  FROM operations.chatby_conversation_links x
  WHERE x.canonical_order_id=d.canonical_order_id
  ORDER BY x.observed_at DESC LIMIT 1
) l ON true;

-- Append-only event records already exist. These views expose them as explicit state histories.
CREATE OR REPLACE VIEW read_models.order_state_history AS
SELECT t.timeline_id AS history_id,t.canonical_order_id,
       t.summary_masked->>'status' AS status,t.summary_masked->>'sub_status' AS sub_status,
       t.summary_masked->>'lifecycle_status' AS lifecycle_status,
       t.source AS event_source,t.timeline_id AS source_event_id,
       t.occurred_at AS observed_at,t.occurred_at AS effective_at,
       replace(t.timeline_id,'dropea-order-','') AS payload_hash,t.freshness,
       0::integer AS actions_executed,0::integer AS production_writes
FROM read_models.operations_timeline_records t
WHERE t.event_type='DROPEA_ORDER_OBSERVED';

CREATE OR REPLACE VIEW read_models.issue_state_history AS
SELECT t.timeline_id AS history_id,t.canonical_issue_id,t.canonical_order_id,
       t.summary_masked->>'status' AS status,
       coalesce((t.summary_masked->>'is_active')::boolean,false) AS is_active,
       t.summary_masked->>'initial_carrier_code' AS carrier_code,
       t.summary_masked->>'normalized_type' AS normalized_type,
       t.summary_masked->>'resolution_status' AS resolution_status,
       t.timeline_id AS source_event_id,t.occurred_at AS observed_at,t.occurred_at AS effective_at,
       replace(t.timeline_id,'dropea-issue-','') AS payload_hash,t.freshness,
       0::integer AS actions_executed,0::integer AS production_writes
FROM read_models.operations_timeline_records t
WHERE t.event_type='DROPEA_INCIDENT_OBSERVED';

-- Normalize the observed carrier registry without changing the legacy mapper contract.
DROP VIEW IF EXISTS read_models.integration_carrier_issue_code_registry;
CREATE VIEW read_models.integration_carrier_issue_code_registry AS
SELECT carrier,market,code,normalized_type,
       description_example_sanitized,first_seen_at,last_seen_at,occurrences,
       CASE mapping_status WHEN 'MAPPED' THEN 'VERIFIED' WHEN 'UNMAPPED' THEN 'UNKNOWN'
         WHEN 'PROVISIONAL' THEN 'PROVISIONAL' WHEN 'DEPRECATED' THEN 'DEPRECATED'
         ELSE 'UNKNOWN' END AS mapping_status,
       policy_id,human_review AS human_review_required,automation_allowed,updated_at,
       actions_executed,production_writes,last_verified_at
FROM integration.carrier_issue_code_registry;

-- Findings are derived from the existing mirrors/ledger and are never silently corrected.
CREATE OR REPLACE VIEW read_models.reconciliation_findings AS
SELECT md5('IDENTITY_CONFLICT:'||canonical_order_id) AS finding_id,canonical_order_id,NULL::text AS canonical_issue_id,
       'IDENTITY_CONFLICT'::text AS finding_type,'CRITICAL'::text AS severity,
       'DROPEA_IDENTITY'::text AS source_a,'OPERATIONS_READ_MODEL'::text AS source_b,
       updated_at AS detected_at,NULL::timestamptz AS resolved_at,'OPEN'::text AS status,
       jsonb_build_object('identity_status',identity_status) AS evidence_sanitized
FROM read_models.operations_order_records WHERE identity_status='CONFLICTING'
UNION ALL
SELECT md5('STALE_ORDER:'||canonical_order_id),canonical_order_id,NULL,'STALE_DATA','HIGH',
       source_system,'OPERATIONS_READ_MODEL',updated_at,NULL,'OPEN',jsonb_build_object('resource','ORDER','freshness',freshness)
FROM read_models.operations_order_records WHERE freshness='STALE'
UNION ALL
SELECT md5('STALE_ISSUE:'||canonical_issue_id),canonical_order_id,canonical_issue_id,'STALE_DATA','HIGH',
       'DROPEA_PUBLIC_API_V2','OPERATIONS_READ_MODEL',updated_at,NULL,'OPEN',jsonb_build_object('resource','ISSUE','freshness',freshness)
FROM read_models.operations_incident_records WHERE freshness='STALE'
UNION ALL
SELECT md5('CHATBY_MISSING:'||i.canonical_issue_id),i.canonical_order_id,i.canonical_issue_id,
       'CHATBY_CONVERSATION_MISSING','HIGH','DROPEA_ISSUE','CHATBY',i.updated_at,NULL,'OPEN',
       jsonb_build_object('conversation_status',coalesce(l.conversation_status,'NONE'))
FROM read_models.operations_incident_records i
LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
WHERE i.status='PENDING' AND i.is_active=true AND coalesce(l.conversation_status,'NONE')='NONE'
UNION ALL
SELECT md5('CHATBY_MULTIPLE:'||i.canonical_issue_id),i.canonical_order_id,i.canonical_issue_id,
       'CHATBY_MULTIPLE_CONVERSATIONS','CRITICAL','DROPEA_ISSUE','CHATBY',l.observed_at,NULL,'OPEN',
       jsonb_build_object('conversation_status',l.conversation_status)
FROM read_models.operations_incident_records i
JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
WHERE l.conversation_status='MULTIPLE'
UNION ALL
SELECT md5('UNKNOWN_GLS_CODE:'||r.market||':'||r.code),NULL,NULL,'UNKNOWN_GLS_CODE','HIGH',
       'DROPEA_ISSUE','GLS_CODE_REGISTRY',r.last_seen_at,NULL,'OPEN',
       jsonb_build_object('carrier',r.carrier,'market',r.market,'code',r.code)
FROM integration.carrier_issue_code_registry r WHERE r.mapping_status NOT IN ('MAPPED','VERIFIED')
UNION ALL
SELECT md5('OUT_OF_ORDER_EVENT:'||event_id),NULL,NULL,'OUT_OF_ORDER_EVENT','MEDIUM',
       'DROPEA_WEBHOOK','DROPEA_POLL',received_at,NULL,'OPEN',jsonb_build_object('topic',topic,'market',market,'store_id',store_id)
FROM integration.dropea_webhook_events WHERE late_event=true;

-- End-to-end operational timeline, sourced only from masked/derived records.
CREATE OR REPLACE VIEW read_models.operations_order_timeline AS
SELECT timeline_id AS timeline_event_id,canonical_order_id,canonical_issue_id,event_type,
       source AS event_source,occurred_at,summary_masked AS summary_sanitized,
       md5(timeline_id) AS source_reference_hash,'1'::text AS event_version,freshness
FROM read_models.operations_timeline_records
UNION ALL
SELECT 'timer:'||timer_id,canonical_order_id,canonical_issue_id,'TIMER_'||status,'SULEIA_TIMER',
       updated_at,jsonb_build_object('timer_type',timer_type,'started_at',started_at,'due_at',due_at,'status',status),
       md5(timer_id),policy_version,'FRESH'
FROM operations.incident_timers
UNION ALL
SELECT 'intent:'||intent_id::text,canonical_order_id,canonical_issue_id,'CUSTOMER_INTENT','CHATBY_INTERPRETATION',
       detected_at,jsonb_build_object('intent',detected_intent,'confidence',confidence,'contradiction',contradiction),
       md5(message_id_hash),relevant_to_issue_version,'FRESH'
FROM operations.incident_intent_timeline
UNION ALL
SELECT 'decision:'||simulation_id,canonical_order_id,canonical_issue_id,'SIMULATED_DECISION','SULEIA_SIMULATION',
       created_at,jsonb_build_object('decision',simulated_decision,'risk',risk,'qa_status',qa_status,'human_review',human_review),
       md5(simulation_id),policy_version,'FRESH'
FROM operations.incident_simulation_decisions
UNION ALL
SELECT 'reconciliation:'||finding_id,canonical_order_id,canonical_issue_id,'RECONCILIATION_'||finding_type,
       'SULEIA_RECONCILIATION',detected_at,evidence_sanitized,md5(finding_id),'1','FRESH'
FROM read_models.reconciliation_findings;

-- Central incident context shared by Operations Center and MCP.
CREATE OR REPLACE VIEW read_models.operations_incident_context AS
SELECT i.canonical_issue_id,i.dropea_issue_id,i.canonical_order_id,i.dropea_order_id,
       i.market,i.store_id,o.status AS order_status,o.sub_status AS order_sub_status,
       d.lifecycle_status,o.product_display_names,o.total_amount,o.currency,o.carrier,
       i.status,i.is_active,i.type AS normalized_type,i.raw_type,i.initial_carrier_code,
       i.initial_carrier_description_sanitized,i.initial_carrier_substatus_code,
       i.allowed_resolution_options,i.capability_status,i.resolution_status,
       i.delivery_attempt_number,i.created_at,i.updated_at,
       extract(epoch from (now()-i.created_at))::bigint AS age_seconds,
       coalesce(l.conversation_status,'UNKNOWN') AS conversation_status,l.reason_code AS conversation_reason,
       l.identity_method AS conversation_identity_method,l.customer_replied AS customer_replied_after_issue,
       l.last_customer_message_at AS latest_customer_activity_at,l.last_suleia_message_at AS latest_suleia_activity_at,
       l.last_button AS last_button_intent,l.latest_template_hash,l.conversation_age_seconds,
       coalesce(l.conversation_freshness,'UNKNOWN') AS conversation_freshness,l.observed_at AS conversation_snapshot_at,
       l.conversation_source_version,x.customer_intent,x.contradiction,x.interpretation_confidence,
       x.interpretation_summary,x.messages_used,x.messages_ignored,
       i.policy_id,coalesce(sd.policy_version,dc.policy_version) AS policy_version,
       t.timer_type,t.started_at AS timer_started_at,t.due_at AS timer_due_at,t.status AS timer_status,
       sd.simulated_decision,sd.simulated_action AS simulated_action_type,sd.blocking_reasons,
       coalesce(sd.risk,i.risk) AS risk,coalesce(sd.qa_status,i.qa_result) AS qa_status,
       coalesce(sd.human_review,i.human_review) AS human_review,
       o.identity_status,i.freshness,i.mapping_status,
       CASE WHEN o.identity_status NOT IN ('EXACT','VERIFIED') THEN 'IDENTITY_UNCERTAIN'
            WHEN i.freshness='STALE' THEN 'STALE'
            WHEN i.mapping_status='UNMAPPED' THEN 'MAPPING_UNKNOWN' ELSE 'OK' END AS data_quality_status,
       'DROPEA_PUBLIC_API_V2'::text AS source_system,i.observed_at AS source_updated_at,i.observed_at,
       i.actions_executed,i.production_writes,i.run_mode
FROM read_models.operations_incident_records i
JOIN read_models.operations_order_records o USING(canonical_order_id)
LEFT JOIN integration.dropea_orders d USING(canonical_order_id)
LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id)
LEFT JOIN read_models.operations_incident_interpretations x USING(canonical_issue_id)
LEFT JOIN read_models.operations_decision_cards dc ON dc.decision_id=i.decision_id
LEFT JOIN LATERAL (
  SELECT q.* FROM operations.incident_timers q WHERE q.canonical_issue_id=i.canonical_issue_id
  ORDER BY (q.status='ACTIVE') DESC,q.updated_at DESC LIMIT 1
) t ON true
LEFT JOIN LATERAL (
  SELECT q.* FROM operations.incident_simulation_decisions q WHERE q.canonical_issue_id=i.canonical_issue_id
  ORDER BY q.created_at DESC LIMIT 1
) sd ON true;

-- Central order context uses the same incident/timer/decision facts as the incident context.
CREATE OR REPLACE VIEW read_models.operations_order_context AS
SELECT o.canonical_order_id,o.market,o.store_id,o.dropea_order_id,o.external_order_id_hash,
       o.status,o.sub_status,d.lifecycle_status,o.product_display_names,o.product_summary,
       o.total_amount,o.currency,d.payment_method,o.carrier,o.service_type,
       d.created_at_utc,d.updated_at_utc,o.updated_at,d.confirmed_at_utc,d.processing_at_utc,d.delivered_at_utc,
       d.cancelled_at_utc,d.returned_at_utc,
       ai.canonical_issue_id AS active_issue_id,ai.status AS active_issue_status,
       ai.normalized_type AS active_issue_type,ai.initial_carrier_code AS active_issue_carrier_code,
       (SELECT count(*)::integer FROM read_models.operations_incident_records h WHERE h.canonical_order_id=o.canonical_order_id) AS incident_count,
       ai.conversation_status,ai.customer_replied_after_issue,ai.latest_customer_activity_at,
       ai.customer_intent AS latest_customer_intent,ai.contradiction,ai.timer_type,
       ai.timer_started_at,ai.timer_due_at,ai.timer_status,ai.policy_id,ai.policy_version,
       ai.simulated_decision,ai.simulated_action_type,ai.blocking_reasons,
       o.duplicate_status,
       (SELECT count(*)::integer FROM read_models.issue_state_history h
         WHERE h.canonical_order_id=o.canonical_order_id AND coalesce(h.resolution_status,'') LIKE 'RETURN%') AS return_history_count,
       coalesce(ai.risk,o.risk) AS risk,coalesce(ai.human_review,o.protection_review) AS human_review,
       o.identity_status,o.freshness,
       CASE WHEN o.identity_status NOT IN ('EXACT','VERIFIED') THEN 'IDENTITY_UNCERTAIN'
            WHEN o.freshness='STALE' THEN 'STALE' ELSE 'OK' END AS data_quality_status,
       o.source_system,d.source_version,d.observed_at AS source_updated_at,d.observed_at,
       o.actions_executed,o.production_writes,o.run_mode
FROM read_models.operations_order_records o
LEFT JOIN integration.dropea_orders d USING(canonical_order_id)
LEFT JOIN LATERAL (
  SELECT q.* FROM read_models.operations_incident_context q
  WHERE q.canonical_order_id=o.canonical_order_id AND q.status='PENDING' AND q.is_active=true
  ORDER BY q.updated_at DESC LIMIT 1
) ai ON true;

CREATE OR REPLACE VIEW read_models.operations_review_queue AS
SELECT 'ORDER'::text AS resource_type,canonical_order_id,NULL::text AS canonical_issue_id,
       risk,priority,updated_at,ARRAY_REMOVE(ARRAY[
         CASE WHEN protection_review THEN 'PROTECTION_REVIEW' END,
         CASE WHEN identity_status NOT IN ('EXACT','VERIFIED') THEN 'IDENTITY_UNCERTAIN' END,
         CASE WHEN freshness='STALE' THEN 'STALE_DATA' END],NULL) AS review_reasons,
       0::integer AS actions_executed,0::integer AS production_writes
FROM read_models.operations_order_records
WHERE protection_review OR identity_status NOT IN ('EXACT','VERIFIED') OR freshness='STALE'
UNION ALL
SELECT 'INCIDENT',canonical_order_id,canonical_issue_id,risk,priority,updated_at,
       ARRAY_REMOVE(blocking_reasons||ARRAY[
         CASE WHEN human_review THEN 'HUMAN_REVIEW' END,
         CASE WHEN mapping_status='UNMAPPED' THEN 'UNKNOWN_CARRIER_CODE' END],NULL),
       0,0
FROM read_models.operations_incident_records
WHERE human_review OR qa_result='BLOCKED' OR mapping_status='UNMAPPED';

CREATE OR REPLACE VIEW read_models.operations_data_quality AS
SELECT
  (SELECT count(*)::integer FROM read_models.operations_order_records) AS orders_total,
  (SELECT count(*)::integer FROM read_models.operations_order_records WHERE identity_status IN ('EXACT','VERIFIED')) AS orders_identity_exact,
  (SELECT count(*)::integer FROM read_models.operations_order_records WHERE identity_status='CONFLICTING') AS orders_identity_conflicting,
  (SELECT count(*)::integer FROM read_models.operations_incident_records) AS issues_total,
  (SELECT count(*)::integer FROM read_models.operations_incident_records WHERE mapping_status='UNMAPPED') AS issues_unknown_code,
  (SELECT count(*)::integer FROM read_models.reconciliation_findings WHERE finding_type='CHATBY_CONVERSATION_MISSING') AS incidents_without_conversation,
  (SELECT count(*)::integer FROM read_models.reconciliation_findings WHERE finding_type='CHATBY_MULTIPLE_CONVERSATIONS') AS multiple_conversations,
  (SELECT count(*)::integer FROM read_models.operations_order_records WHERE freshness='STALE') AS stale_orders,
  (SELECT count(*)::integer FROM read_models.operations_incident_records WHERE freshness='STALE') AS stale_issues,
  (SELECT count(*)::integer FROM read_models.reconciliation_findings WHERE finding_type='EVENT_GAP') AS event_gaps,
  (SELECT count(*)::integer FROM read_models.reconciliation_findings WHERE status='OPEN') AS reconciliation_findings,
  (SELECT count(*)::integer FROM read_models.reconciliation_findings WHERE finding_type='READ_MODEL_MISMATCH') AS read_model_mismatches,
  now() AS measured_at,0::integer AS actions_executed,0::integer AS production_writes;

-- Keep the existing customer history and add the missing analysis-only metrics at the end.
CREATE OR REPLACE VIEW read_models.customer_operational_history AS
WITH order_rollup AS (
  SELECT o.customer_identity_hash AS customer_key,count(*)::integer AS orders_total,
    count(*) FILTER (WHERE o.lifecycle_status IN ('DELIVERED','FINISHED'))::integer AS delivered,
    count(*) FILTER (WHERE o.lifecycle_status IN ('CANCELLED','REJECTED'))::integer AS cancelled,
    count(*) FILTER (WHERE r.duplicate_status='DUPLICATE_ACTIVE_ORDER')::integer AS duplicate_attempts,
    max(o.created_at_utc) AS last_order_at,
    count(*) FILTER (WHERE o.lifecycle_status NOT IN ('DELIVERED','FINISHED','CANCELLED','REJECTED','RETURNED'))::integer AS orders_active
  FROM integration.dropea_orders o JOIN read_models.operations_order_records r USING(canonical_order_id)
  WHERE o.customer_identity_hash IS NOT NULL GROUP BY o.customer_identity_hash
), issue_rollup AS (
  SELECT o.customer_identity_hash AS customer_key,count(i.*)::integer AS incidents,
    count(*) FILTER (WHERE i.canonical_type='RECIPIENT_ABSENT' AND i.delivery_attempt_number IN ('1','FIRST','FIRST_ATTEMPT'))::integer AS first_absence,
    count(*) FILTER (WHERE i.canonical_type='RECIPIENT_ABSENT' AND i.delivery_attempt_number IN ('2','SECOND','SECOND_ATTEMPT'))::integer AS second_absence,
    count(*) FILTER (WHERE i.canonical_type='REFUSED_BY_RECIPIENT')::integer AS refused,
    count(*) FILTER (WHERE i.resolution_status='PICKUP_AT_AGENCY')::integer AS pickup_at_agency,
    count(DISTINCT i.canonical_order_id) FILTER (WHERE i.canonical_type IN ('RETURN_REQUESTED','POSSIBLE_RETURN') OR i.resolution_status='RETURN_REQUESTED')::integer AS return_to_origin,
    count(DISTINCT i.canonical_order_id) FILTER (WHERE o.lifecycle_status IN ('DELIVERED','FINISHED'))::integer AS recovery_success,
    count(DISTINCT i.canonical_order_id)::integer AS recovery_attempts,max(i.created_at_utc) AS last_incident_at
  FROM integration.dropea_orders o JOIN integration.dropea_issues i USING(canonical_order_id)
  WHERE o.customer_identity_hash IS NOT NULL GROUP BY o.customer_identity_hash
)
SELECT h.customer_key,h.orders_total,h.delivered,h.cancelled,coalesce(i.return_to_origin,0)::integer AS return_to_origin,
  coalesce(i.incidents,0)::integer AS incidents,coalesce(i.first_absence,0)::integer AS first_absence,
  coalesce(i.second_absence,0)::integer AS second_absence,coalesce(i.refused,0)::integer AS refused,
  coalesce(i.pickup_at_agency,0)::integer AS pickup_at_agency,coalesce(i.recovery_success,0)::integer AS recovery_success,
  h.duplicate_attempts,h.last_order_at,'SHADOW_READ_ONLY'::text AS run_mode,
  0::integer AS actions_executed,0::integer AS production_writes,
  h.orders_active,coalesce(i.recovery_attempts,0)::integer AS recovery_attempts,i.last_incident_at
FROM order_rollup h LEFT JOIN issue_rollup i USING(customer_key);

GRANT SELECT ON read_models.order_identity_map,read_models.order_state_history,
  read_models.issue_state_history,read_models.operations_order_timeline,
  read_models.reconciliation_findings,read_models.operations_incident_context,
  read_models.operations_order_context,read_models.operations_review_queue,
  read_models.operations_data_quality,read_models.customer_operational_history,
  read_models.integration_carrier_issue_code_registry
TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;

COMMIT;
