BEGIN;
INSERT INTO configuration.policies(policy_name,description,owner)
VALUES('RECIPIENT_ABSENT_POLICY_V1','Governed recipient-absent SHADOW only; no customer or carrier writes','Codex / owner-authorized shadow')
ON CONFLICT(policy_name) DO NOTHING;
INSERT INTO configuration.policy_versions(policy_name,version,policy_document,checksum,status,effective_from)
VALUES('RECIPIENT_ABSENT_POLICY_V1','RECIPIENT_ABSENT_POLICY_V1',
'{"version":"RECIPIENT_ABSENT_POLICY_V1","mode":"SHADOW","timer_hours":48,"timer_owner":"ingestion-worker:recipient-absent-shadow","reminders":[],"auto_close":false,"auto_cancel_timer":false,"template":"dropea_ausente_v1","timezone":"Europe/Madrid","attempt_precedence":["STRUCTURED","CORROBORATED_CARRIER_MAPPING","ORDER_TIMELINE","SAME_ORDER_HISTORY","UNKNOWN"],"carrier_mapping":{"GLS_ES_SUBSTATUS_15":{"attempt":2,"requires_code":["-30","14"],"requires_description":"AUSENTE SEGUNDA VEZ","evidence":"DROPEA_OBSERVED_COHORT_2026_09_17_9_OF_9","scope":"DROPEA_GLS_ES_ONLY_NOT_UNIVERSAL_GLS_CODE"}},"freshness_seconds":{"dropea":600,"chatby":300,"gls":900},"requirements":{"CONTACT":["DROPEA","EXACT_CHATBY","APPROVED_TEMPLATE"],"WAIT":["DROPEA","EXACT_CHATBY","VALID_48H_TIMER"],"INTERPRET_RESPONSE":["DROPEA","EXACT_CHATBY"],"RESCHEDULE":["DROPEA","EXACT_CHATBY","CARRIER_CAPABILITY","OPERABILITY","RETENTION","CALENDAR"],"PICKUP":["DROPEA","EXACT_CHATBY","CARRIER_CAPABILITY","OPERABILITY","RETENTION","PICKUP_POINT"],"RETURN":["DROPEA","EXACT_CHATBY","CARRIER_CAPABILITY","OPERABILITY","RETENTION"]},"writes_enabled":false,"customer_sends_enabled":false}'::jsonb,
'44db5838092fdbe97de0554e8210a2b0f8cf7d81cff1199f44007cfbdc74cadd','SHADOW',now())
ON CONFLICT(policy_name,version) DO NOTHING;
DO $guard$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM configuration.policy_versions WHERE policy_name='RECIPIENT_ABSENT_POLICY_V1'
    AND version='RECIPIENT_ABSENT_POLICY_V1' AND status='SHADOW'
    AND checksum='44db5838092fdbe97de0554e8210a2b0f8cf7d81cff1199f44007cfbdc74cadd') THEN
    RAISE EXCEPTION 'ABSENT_REGISTRY_CONFLICT: do not overwrite an existing policy';
  END IF;
END $guard$;
INSERT INTO configuration.policy_assignments(policy_id,version_id,workflow,status)
SELECT p.id,v.id,'RECIPIENT_ABSENT','SHADOW' FROM configuration.policies p
JOIN configuration.policy_versions v USING(policy_name) WHERE p.policy_name='RECIPIENT_ABSENT_POLICY_V1'
AND v.version='RECIPIENT_ABSENT_POLICY_V1' ON CONFLICT(workflow,status) DO NOTHING;
DO $assignment_guard$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM configuration.policy_assignments a JOIN configuration.policies p ON p.id=a.policy_id
    JOIN configuration.policy_versions v ON v.id=a.version_id WHERE a.workflow='RECIPIENT_ABSENT' AND a.status='SHADOW'
    AND p.policy_name='RECIPIENT_ABSENT_POLICY_V1' AND v.policy_name=p.policy_name AND v.version='RECIPIENT_ABSENT_POLICY_V1') THEN
    RAISE EXCEPTION 'ABSENT_ASSIGNMENT_CONFLICT';
  END IF;
END $assignment_guard$;
CREATE UNIQUE INDEX IF NOT EXISTS absent_v1_one_response_timer_per_issue ON operations.incident_timers(canonical_issue_id)
WHERE policy_version='RECIPIENT_ABSENT_POLICY_V1' AND timer_type IN('CUSTOMER_INITIAL_RESPONSE_48H','INCIDENT_AUSENTE_48H');
CREATE TABLE IF NOT EXISTS configuration.shadow_schema_releases(
  version text PRIMARY KEY, source_commit text NOT NULL CHECK(source_commit~'^[0-9a-f]{40}$'),
  migration_sha256 text NOT NULL CHECK(migration_sha256~'^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON configuration.shadow_schema_releases FROM PUBLIC;
GRANT SELECT ON configuration.shadow_schema_releases TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;

CREATE TABLE IF NOT EXISTS operations.recipient_absent_decision_snapshots(
  decision_id text PRIMARY KEY,canonical_issue_id text NOT NULL,canonical_order_id text NOT NULL,
  issue_version timestamptz NOT NULL,policy_id uuid NOT NULL REFERENCES configuration.policies(id),
  policy_version text NOT NULL CHECK(policy_version='RECIPIENT_ABSENT_POLICY_V1'),
  policy_snapshot_hash text NOT NULL,input_snapshot_hash text NOT NULL,snapshot jsonb NOT NULL,
  decision_status text NOT NULL,decided_at timestamptz NOT NULL DEFAULT now(),
  supersedes_decision_id text REFERENCES operations.recipient_absent_decision_snapshots(decision_id),
  CHECK(snapshot @> '{"executed":false,"external_action":false,"production_write":false}'::jsonb),
  CHECK(snapshot->'live_flags'='{"AUSENTE_AUTOMATION_LIVE":false,"CHATBY_REAL_SENDS":false,"DROPEA_ACTIONS_ENABLED":false,"GLS_ACTIONS_ENABLED":false}'::jsonb)
);
CREATE INDEX IF NOT EXISTS recipient_absent_snapshot_issue_idx ON operations.recipient_absent_decision_snapshots(canonical_issue_id,decided_at DESC);
REVOKE ALL ON operations.recipient_absent_decision_snapshots FROM PUBLIC;
GRANT SELECT,INSERT ON operations.recipient_absent_decision_snapshots TO suleia_ingestion;
GRANT SELECT ON configuration.policies,configuration.policy_versions,configuration.policy_assignments,
  operations.recipient_absent_decision_snapshots TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
GRANT USAGE ON SCHEMA configuration TO suleia_ingestion;

-- Keep the original notification-only view and all non-AUSENTE semantics intact.
-- The private absence wrapper accepts an issue-created anchor ONLY in SHADOW,
-- labelled as simulation, never as proof that a customer was notified.
CREATE OR REPLACE VIEW read_models.recipient_absent_current_context AS
SELECT r.canonical_issue_id,r.canonical_order_id,r.absent_shadow AS shadow,d.decided_at,d.supersedes_decision_id,
  coalesce(r.absent_shadow IS NOT NULL AND d.decision_id IS NOT NULL
    AND d.issue_version=r.updated_at AND d.input_snapshot_hash=r.absent_shadow->>'input_snapshot_hash'
    AND d.policy_snapshot_hash=v.checksum AND v.status='SHADOW' AND pa.status='SHADOW'
    AND coalesce(m.chatby_message_id_hash,'')=coalesce(r.absent_shadow->>'scoped_customer_message_hash','')
    AND r.absent_shadow->'input_snapshot'->>'order_state'=o.canonical_state
    AND (r.absent_shadow->'input_snapshot'->'timer' IS NULL OR r.absent_shadow->'input_snapshot'->'timer'='null'::jsonb
      OR coalesce((r.absent_shadow->'input_snapshot'->'timer'->>'expired')::boolean,false)=((r.absent_shadow->'input_snapshot'->'timer'->>'due_at')::timestamptz<=now()))
    AND r.absent_shadow->'data_freshness'->>'dropea'=CASE WHEN f.last_successful_sync_at>=now()-interval '600 seconds' THEN 'FRESH' ELSE 'STALE' END
    AND r.absent_shadow->'data_freshness'->>'chatby'=CASE WHEN l.conversation_status IS DISTINCT FROM 'FOUND' OR l.observed_at IS NULL THEN 'UNKNOWN' WHEN l.observed_at>=now()-interval '300 seconds' AND l.observed_at<=now() THEN 'FRESH' ELSE 'STALE' END,false) AS current,
  CASE WHEN f.last_successful_sync_at<now()-interval '600 seconds' OR f.last_successful_sync_at IS NULL THEN 'STALE'
    WHEN l.conversation_status IS DISTINCT FROM 'FOUND' OR l.observed_at IS NULL THEN 'UNKNOWN'
    WHEN l.observed_at<now()-interval '300 seconds' OR l.observed_at>now() THEN 'STALE'
    WHEN r.absent_shadow->'logistics_capabilities'->>'requirement' IN('RESCHEDULE','PICKUP','RETURN','ADDRESS')
      AND r.absent_shadow->'data_freshness'->>'gls'='STALE' THEN 'STALE'
    WHEN r.absent_shadow->'logistics_capabilities'->>'requirement' IN('RESCHEDULE','PICKUP','RETURN','ADDRESS')
      AND coalesce(r.absent_shadow->'data_freshness'->>'gls','UNKNOWN')<>'FRESH' THEN 'UNKNOWN' ELSE 'FRESH' END AS effective_freshness
FROM read_models.operations_incident_records r JOIN read_models.operations_order_records o USING(canonical_order_id)
LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id,canonical_order_id)
LEFT JOIN operations.recipient_absent_decision_snapshots d ON d.decision_id=r.absent_shadow->>'decision_id'
LEFT JOIN configuration.policy_versions v ON v.policy_name='RECIPIENT_ABSENT_POLICY_V1' AND v.version='RECIPIENT_ABSENT_POLICY_V1'
LEFT JOIN configuration.policy_assignments pa ON pa.version_id=v.id AND pa.policy_id=d.policy_id AND pa.workflow='RECIPIENT_ABSENT'
LEFT JOIN LATERAL(SELECT last_successful_sync_at FROM read_models.operations_data_freshness
  WHERE market=r.market AND store_id=r.store_id AND resource_type='issues' AND pagination_complete ORDER BY last_successful_sync_at DESC LIMIT 1) f ON true
LEFT JOIN LATERAL(SELECT chatby_message_id_hash FROM operations.chatby_private_message_display
  WHERE canonical_issue_id=r.canonical_issue_id AND canonical_order_id=r.canonical_order_id AND direction='INBOUND'
    AND occurred_at>coalesce(l.notification_observed_at,r.created_at) AND occurred_at<=l.observed_at
    AND coalesce(incident_relevance,'') NOT IN('ORDER_LIFECYCLE_ONLY','DISCOUNT_RESPONSE','BEFORE_INCIDENT','BEFORE_NOTIFICATION')
    AND coalesce(context_template_slug,'') NOT LIKE 'dropea_pedido_%'
  ORDER BY occurred_at DESC,chatby_message_id_hash DESC LIMIT 1) m ON l.conversation_status='FOUND' AND l.observed_at>=now()-interval '300 seconds'
WHERE r.type='RECIPIENT_ABSENT';
REVOKE ALL ON read_models.recipient_absent_current_context FROM PUBLIC;
GRANT SELECT ON read_models.recipient_absent_current_context TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;

DO $migration$
DECLARE columns_sql text;
BEGIN
  -- Save the previous complete contract as a baseline. Rollback can restore it
  -- without reconstructing unrelated finance/rejection views or mutating timers.
  IF to_regclass('read_models.operations_incident_evidence_pre_absent_integrity') IS NULL THEN
    EXECUTE 'ALTER VIEW read_models.operations_incident_evidence_context RENAME TO operations_incident_evidence_pre_absent_integrity';
  END IF;
  SELECT string_agg(CASE a.attname
    WHEN 'policy_id' THEN 'CASE WHEN ac.current THEN ac.shadow->>''policy_id'' ELSE p.policy_id END AS policy_id'
    WHEN 'policy_version' THEN 'CASE WHEN ac.current THEN ac.shadow->>''policy_version'' ELSE p.policy_version END AS policy_version'
    WHEN 'policy_snapshot_hash' THEN 'CASE WHEN ac.current THEN ac.shadow->>''policy_snapshot_hash'' ELSE p.policy_snapshot_hash END AS policy_snapshot_hash'
    WHEN 'input_snapshot_hash' THEN 'CASE WHEN ac.current THEN ac.shadow->>''input_snapshot_hash'' ELSE p.input_snapshot_hash END AS input_snapshot_hash'
    WHEN 'snapshot_status' THEN 'CASE WHEN ac.current THEN ''PERSISTED'' ELSE p.snapshot_status END AS snapshot_status'
    WHEN 'current_decision_id' THEN 'CASE WHEN ac.current THEN ac.shadow->>''decision_id'' ELSE p.current_decision_id END AS current_decision_id'
    WHEN 'decided_at' THEN 'CASE WHEN ac.current THEN ac.decided_at ELSE p.decided_at END AS decided_at'
    WHEN 'supersedes_decision_id' THEN 'CASE WHEN ac.current THEN ac.supersedes_decision_id ELSE p.supersedes_decision_id END AS supersedes_decision_id'
    WHEN 'decision_record_status' THEN 'CASE WHEN ac.current THEN ''PERSISTED'' ELSE p.decision_record_status END AS decision_record_status'
    WHEN 'current_preview_status' THEN 'CASE WHEN ac.current THEN ''MATERIALIZED'' ELSE p.current_preview_status END AS current_preview_status'
    WHEN 'notification_decision_current' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.current ELSE p.notification_decision_current END AS notification_decision_current'
    WHEN 'waiting_customer' THEN 'CASE WHEN ac.current THEN coalesce((ac.shadow->>''waiting_customer'')::boolean,false) AND (ac.shadow->>''due_at'')::timestamptz>now() ELSE p.waiting_customer END AS waiting_customer'
    WHEN 'interpreted_type' THEN 'CASE WHEN ac.current THEN ac.shadow->>''interpreted_type'' ELSE p.interpreted_type END AS interpreted_type'
    WHEN 'customer_intent' THEN 'CASE WHEN ac.current THEN ac.shadow->>''customer_intent'' ELSE p.customer_intent END AS customer_intent'
    WHEN 'customer_replied_after_issue' THEN 'CASE WHEN ac.current THEN ac.shadow->>''customer_response_status''=''RESPONDED'' ELSE p.customer_replied_after_issue END AS customer_replied_after_issue'
    WHEN 'latest_customer_activity_at' THEN 'CASE WHEN ac.current THEN (ac.shadow->>''scoped_customer_activity_at'')::timestamptz ELSE p.latest_customer_activity_at END AS latest_customer_activity_at'
    WHEN 'scoped_customer_activity_at' THEN 'CASE WHEN ac.current THEN (ac.shadow->>''scoped_customer_activity_at'')::timestamptz ELSE p.scoped_customer_activity_at END AS scoped_customer_activity_at'
    WHEN 'scoped_customer_message_hash' THEN 'CASE WHEN ac.current THEN ac.shadow->>''scoped_customer_message_hash'' ELSE p.scoped_customer_message_hash END AS scoped_customer_message_hash'
    WHEN 'scoped_customer_intent' THEN 'CASE WHEN ac.current THEN ac.shadow->>''customer_intent'' ELSE p.scoped_customer_intent END AS scoped_customer_intent'
    WHEN 'scoped_response_status' THEN 'CASE WHEN ac.current AND ac.shadow->>''customer_response_status''<>''NOT_VERIFIABLE'' THEN CASE WHEN ac.shadow->>''customer_response_status''=''RESPONDED'' THEN ''VALID_RESPONSE'' ELSE ''NO_VALID_RESPONSE'' END ELSE p.scoped_response_status END AS scoped_response_status'
    WHEN 'scoped_response_reason' THEN 'CASE WHEN ac.current AND p.incident_notified_at IS NULL THEN ''SHADOW_ISSUE_CREATED_ANCHOR_ONLY_NOT_NOTIFICATION'' ELSE p.scoped_response_reason END AS scoped_response_reason'
    WHEN 'freshness' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.effective_freshness ELSE p.freshness END AS freshness'
    WHEN 'effective_freshness_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.effective_freshness ELSE p.effective_freshness_status END AS effective_freshness_status'
    WHEN 'effective_decision_status' THEN 'CASE WHEN ac.current THEN ac.shadow->>''simulation_status'' ELSE p.effective_decision_status END AS effective_decision_status'
    WHEN 'effective_simulated_action_type' THEN 'CASE WHEN ac.current THEN ac.shadow->>''simulation_action'' ELSE p.effective_simulated_action_type END AS effective_simulated_action_type'
    WHEN 'effective_human_review' THEN 'CASE WHEN ac.current THEN ac.shadow->>''simulation_status''=''HUMAN_REVIEW_REQUIRED'' ELSE p.effective_human_review END AS effective_human_review'
    WHEN 'effective_blocking_reasons' THEN 'CASE WHEN ac.current THEN ARRAY(SELECT jsonb_array_elements_text(ac.shadow->''blocking_reasons'')) ELSE p.effective_blocking_reasons END AS effective_blocking_reasons'
    WHEN 'conditional_proposal' THEN 'CASE WHEN ac.current THEN ac.shadow->>''conditional_proposal'' ELSE p.conditional_proposal END AS conditional_proposal'
    WHEN 'reason_summary' THEN 'CASE WHEN ac.current THEN ac.shadow->>''reason_text'' ELSE p.reason_summary END AS reason_summary'
    WHEN 'decision_confidence' THEN 'CASE WHEN ac.current THEN (ac.shadow->>''decision_confidence'')::numeric ELSE p.decision_confidence END AS decision_confidence'
    ELSE format('p.%I',a.attname) END,',' ORDER BY a.attnum) INTO columns_sql
  FROM pg_attribute a WHERE a.attrelid='read_models.operations_incident_evidence_pre_absent_integrity'::regclass AND a.attnum>0 AND NOT a.attisdropped;
  EXECUTE format('CREATE OR REPLACE VIEW read_models.operations_incident_evidence_context AS SELECT %s FROM read_models.operations_incident_evidence_pre_absent_integrity p LEFT JOIN read_models.recipient_absent_current_context ac USING(canonical_issue_id,canonical_order_id)',columns_sql);
END $migration$;
REVOKE ALL ON read_models.operations_incident_evidence_context FROM PUBLIC;
GRANT SELECT ON read_models.operations_incident_evidence_context TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
COMMIT;
