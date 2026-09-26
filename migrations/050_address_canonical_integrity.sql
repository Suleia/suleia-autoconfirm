BEGIN;
INSERT INTO configuration.policies(policy_name,description,owner) VALUES
('ADDRESS_INCORRECT_POLICY_V1','Address owner policy, shadow canonical projection; no external writes','Codex'),
('ADDRESS_INCORRECT_RESPONSE_V1','One notification anchored 24h/48h window; partial replies supersede silence','Codex') ON CONFLICT(policy_name) DO NOTHING;
INSERT INTO configuration.policy_versions(policy_name,version,policy_document,checksum,status,effective_from)
SELECT policy_name,policy_name,'{"id":"ADDRESS_INCORRECT_POLICY_V1","response_policy":"ADDRESS_INCORRECT_RESPONSE_V1","version":"2026-09-26.2","offer_hours":24,"return_hours":48,"anchor":"REAL_INITIAL_TEMPLATE_SEND","partial_response":"WAIT_DETAILS_THEN_MANUAL_REVIEW","discount_application":"MANUAL_ONLY","owner":"render_incident_automation"}'::jsonb,'dc831ceaf6e0518d22b5cd267b9bb3c78b378633a27000f589a07f4b64619cfe','SHADOW',now()
FROM configuration.policies WHERE policy_name IN('ADDRESS_INCORRECT_POLICY_V1','ADDRESS_INCORRECT_RESPONSE_V1') ON CONFLICT(policy_name,version) DO NOTHING;
INSERT INTO configuration.policy_assignments(policy_id,version_id,workflow,status)
SELECT p.id,v.id,CASE p.policy_name WHEN 'ADDRESS_INCORRECT_POLICY_V1' THEN 'ADDRESS_INCORRECT' ELSE 'ADDRESS_INCORRECT_RESPONSE' END,'SHADOW'
FROM configuration.policies p JOIN configuration.policy_versions v USING(policy_name)
WHERE p.policy_name IN('ADDRESS_INCORRECT_POLICY_V1','ADDRESS_INCORRECT_RESPONSE_V1') AND v.version=p.policy_name ON CONFLICT(workflow,status) DO NOTHING;
DO $guard$ BEGIN
IF (SELECT count(*) FROM configuration.policies p JOIN configuration.policy_versions v USING(policy_name)
JOIN configuration.policy_assignments a ON a.policy_id=p.id AND a.version_id=v.id
WHERE p.policy_name IN('ADDRESS_INCORRECT_POLICY_V1','ADDRESS_INCORRECT_RESPONSE_V1') AND v.version=p.policy_name AND v.checksum='dc831ceaf6e0518d22b5cd267b9bb3c78b378633a27000f589a07f4b64619cfe' AND v.status='SHADOW' AND a.status='SHADOW')<>2
THEN RAISE EXCEPTION 'ADDRESS_POLICY_REGISTRY_CONFLICT'; END IF; END $guard$;
CREATE TABLE IF NOT EXISTS integration.carrier_issue_composite_rules(
 rule_id text PRIMARY KEY,carrier text NOT NULL,market text NOT NULL,code text NOT NULL,substatus text NOT NULL,
 required_raw_type text NOT NULL,required_description text NOT NULL,normalized_type text NOT NULL,policy_name text NOT NULL);
INSERT INTO integration.carrier_issue_composite_rules VALUES('GLS_ES_MINUS30_13_ADDRESS_V1','GLS','ES','-30','13','ADDRESS_INCORRECT','DIRECCION INCORRECTA','ADDRESS_INCORRECT','ADDRESS_INCORRECT_POLICY_V1') ON CONFLICT DO NOTHING;
UPDATE integration.dropea_issues SET canonical_type='ADDRESS_INCORRECT',human_review=false
WHERE carrier='GLS' AND market='ES' AND initial_carrier_code='-30' AND initial_carrier_substatus_code='13'
 AND raw_type='ADDRESS_INCORRECT' AND translate(upper(initial_carrier_description_sanitized),'Ó','O') LIKE '%DIRECCION INCORRECTA%';
UPDATE read_models.operations_incident_records SET type='ADDRESS_INCORRECT',mapping_status='MAPPED',schema_drift_alert=false
WHERE carrier='GLS' AND market='ES' AND initial_carrier_code='-30' AND initial_carrier_substatus_code='13'
 AND raw_type='ADDRESS_INCORRECT' AND translate(upper(initial_carrier_description_sanitized),'Ó','O') LIKE '%DIRECCION INCORRECTA%';
CREATE TABLE IF NOT EXISTS operations.address_decision_snapshots(
 decision_id text PRIMARY KEY,canonical_issue_id text NOT NULL,canonical_order_id text NOT NULL,issue_version timestamptz NOT NULL,
 policy_id uuid NOT NULL REFERENCES configuration.policies(id),policy_version text NOT NULL,policy_snapshot_hash text NOT NULL,
 input_snapshot_hash text NOT NULL,snapshot jsonb NOT NULL,decided_at timestamptz NOT NULL DEFAULT now(),
 CHECK(snapshot @> '{"executed":false,"external_action":false,"production_write":false}'::jsonb));
CREATE INDEX IF NOT EXISTS address_snapshot_issue_idx ON operations.address_decision_snapshots(canonical_issue_id,decided_at DESC);
CREATE TABLE IF NOT EXISTS operations.address_timer_reconciliation(timer_id text PRIMARY KEY,canonical_issue_id text NOT NULL,
 reason text NOT NULL,original_status text NOT NULL,effective_timer_id text,reconciled_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS operations.address_provider_findings(canonical_issue_id text PRIMARY KEY,finding jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS address_one_initial_window ON operations.incident_timers(canonical_issue_id)
WHERE policy_version='ADDRESS_INCORRECT_RESPONSE_V1' AND timer_type='CUSTOMER_INITIAL_RESPONSE_48H';
REVOKE ALL ON integration.carrier_issue_composite_rules,operations.address_decision_snapshots,operations.address_timer_reconciliation,operations.address_provider_findings FROM PUBLIC;
GRANT SELECT ON integration.carrier_issue_composite_rules TO suleia_ingestion,suleia_backup;
GRANT SELECT,INSERT ON operations.address_decision_snapshots TO suleia_ingestion;
GRANT SELECT,INSERT,UPDATE ON operations.address_timer_reconciliation,operations.address_provider_findings TO suleia_ingestion;
GRANT SELECT ON operations.address_decision_snapshots,operations.address_timer_reconciliation,operations.address_provider_findings TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
CREATE OR REPLACE VIEW read_models.address_current_context AS
SELECT i.canonical_issue_id,d.snapshot,d.decided_at,d.decision_id,d.policy_id::text AS policy_id,
 t.timer_id,t.started_at,t.due_at,t.status AS timer_status,t.policy_version AS timer_policy_version,
 f.finding,
 coalesce(d.snapshot->>'current'='true' AND d.issue_version=i.updated_at AND d.policy_snapshot_hash=v.checksum
 AND v.status='SHADOW' AND pa.status='SHADOW' AND i.observed_at>=now()-interval '10 minutes' AND d.snapshot->'input'->>'issue_status'=i.status
 AND (d.snapshot->'input'->>'issue_active')::boolean=i.is_active AND d.snapshot->'input'->>'canonical_type'=i.type
 AND d.snapshot->'input'->>'owner_input_hash'=a.observation->>'input_snapshot_hash'
 AND d.snapshot->'input'->>'read_at'=a.observation->>'read_at'
 AND (a.observation->>'read_at')::timestamptz BETWEEN now()-interval '20 minutes' AND now()
 AND NOT EXISTS(SELECT 1 FROM operations.chatby_private_message_display m WHERE m.canonical_issue_id=i.canonical_issue_id
 AND m.direction='INBOUND' AND m.occurred_at>(a.observation->>'read_at')::timestamptz)
 AND (d.snapshot->'input'->>'milestone')=CASE WHEN t.timer_id IS NULL THEN 'NO_ANCHOR' WHEN t.due_at<=now() THEN 'RETURN_DUE' WHEN t.started_at+interval '24 hours'<=now() THEN 'OFFER_DUE' ELSE 'WAIT' END,false) AS current,
 coalesce((a.observation->>'read_verified')::boolean,false) AND (a.observation->>'read_at')::timestamptz BETWEEN now()-interval '20 minutes' AND now() AS chatby_current
FROM read_models.operations_incident_records i
LEFT JOIN operations.address_owner_observations a USING(canonical_issue_id)
LEFT JOIN LATERAL(SELECT * FROM operations.address_decision_snapshots q WHERE q.canonical_issue_id=i.canonical_issue_id ORDER BY decided_at DESC LIMIT 1) d ON true
LEFT JOIN configuration.policy_versions v ON v.policy_name='ADDRESS_INCORRECT_POLICY_V1' AND v.version='ADDRESS_INCORRECT_POLICY_V1'
LEFT JOIN configuration.policy_assignments pa ON pa.version_id=v.id AND pa.policy_id=d.policy_id AND pa.workflow='ADDRESS_INCORRECT'
LEFT JOIN operations.incident_timers t ON t.canonical_issue_id=i.canonical_issue_id AND t.policy_version='ADDRESS_INCORRECT_RESPONSE_V1'
LEFT JOIN operations.address_provider_findings f ON f.canonical_issue_id=i.canonical_issue_id
WHERE i.type='ADDRESS_INCORRECT' OR i.raw_type='ADDRESS_INCORRECT';
REVOKE ALL ON read_models.address_current_context FROM PUBLIC;
GRANT SELECT ON read_models.address_current_context TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
DO $migration$ DECLARE columns_sql text; BEGIN
IF to_regclass('read_models.operations_incident_evidence_pre_address_integrity') IS NULL THEN
ALTER VIEW read_models.operations_incident_evidence_context RENAME TO operations_incident_evidence_pre_address_integrity; END IF;
SELECT string_agg(CASE a.attname
WHEN 'policy_id' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.policy_id ELSE p.policy_id END AS policy_id'
WHEN 'policy_version' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ''ADDRESS_INCORRECT_POLICY_V1''::text ELSE p.policy_version END AS policy_version'
WHEN 'policy_snapshot_hash' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.snapshot->>''policy_snapshot_hash'' ELSE p.policy_snapshot_hash END AS policy_snapshot_hash'
WHEN 'input_snapshot_hash' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.snapshot->>''input_snapshot_hash'' ELSE p.input_snapshot_hash END AS input_snapshot_hash'
WHEN 'snapshot_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.decision_id IS NOT NULL THEN ''PERSISTED'' ELSE ''NOT_PERSISTED'' END ELSE p.snapshot_status END AS snapshot_status'
WHEN 'current_decision_id' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.current THEN ac.decision_id END ELSE p.current_decision_id END AS current_decision_id'
WHEN 'decided_at' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.decided_at ELSE p.decided_at END AS decided_at'
WHEN 'decision_record_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.current THEN ''CURRENT'' ELSE ''HISTORICAL'' END ELSE p.decision_record_status END AS decision_record_status'
WHEN 'current_preview_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.current THEN ''MATERIALIZED'' ELSE ''NOT_MATERIALIZED'' END ELSE p.current_preview_status END AS current_preview_status'
WHEN 'notification_decision_current' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.current ELSE p.notification_decision_current END AS notification_decision_current'
WHEN 'waiting_customer' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.current AND ac.finding IS NULL AND ac.timer_status=''ACTIVE'' AND ac.due_at>now() AND ac.snapshot->>''action''=''WAIT_FOR_CUSTOMER'' ELSE p.waiting_customer END AS waiting_customer'
WHEN 'timer_id' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.timer_id ELSE p.timer_id END AS timer_id'
WHEN 'timer_started_at' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.started_at ELSE p.timer_started_at END AS timer_started_at'
WHEN 'timer_due_at' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.due_at ELSE p.timer_due_at END AS timer_due_at'
WHEN 'timer_type' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.timer_id IS NOT NULL THEN ''CUSTOMER_INITIAL_RESPONSE_48H'' END ELSE p.timer_type END AS timer_type'
WHEN 'timer_policy_version' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.timer_policy_version ELSE p.timer_policy_version END AS timer_policy_version'
WHEN 'timer_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.timer_status ELSE p.timer_status END AS timer_status'
WHEN 'stored_timer_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.timer_status ELSE p.stored_timer_status END AS stored_timer_status'
WHEN 'effective_timer_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.timer_status=''ACTIVE'' AND ac.due_at<=now() THEN ''EXPIRED'' ELSE ac.timer_status END ELSE p.effective_timer_status END AS effective_timer_status'
WHEN 'effective_deadline_at' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.due_at ELSE p.effective_deadline_at END AS effective_deadline_at'
WHEN 'incident_notified_at' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN (ac.snapshot->''input''->>''notification_at'')::timestamptz ELSE p.incident_notified_at END AS incident_notified_at'
WHEN 'effective_decision_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.finding IS NOT NULL THEN ''PROVIDER_RECONCILIATION_REQUIRED'' WHEN ac.current THEN ac.snapshot->>''state'' ELSE ''HUMAN_REVIEW'' END ELSE p.effective_decision_status END AS effective_decision_status'
WHEN 'effective_simulated_action_type' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.finding IS NOT NULL OR NOT ac.current THEN ''HUMAN_REVIEW'' ELSE ac.snapshot->>''action'' END ELSE p.effective_simulated_action_type END AS effective_simulated_action_type'
WHEN 'effective_human_review' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.finding IS NOT NULL OR NOT ac.current OR ac.snapshot->>''action''=''HUMAN_REVIEW'' ELSE p.effective_human_review END AS effective_human_review'
WHEN 'effective_blocking_reasons' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ARRAY(SELECT jsonb_array_elements_text(coalesce(ac.snapshot->''current_blockers'',''[]''::jsonb))) || CASE WHEN ac.current THEN ''{}''::text[] ELSE ARRAY[''CURRENT_DECISION_NOT_VERIFIED''] END ELSE p.effective_blocking_reasons END AS effective_blocking_reasons'
WHEN 'blocking_reasons' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ARRAY(SELECT jsonb_array_elements_text(coalesce(ac.snapshot->''current_blockers'',''[]''::jsonb))) ELSE p.blocking_reasons END AS blocking_reasons'
WHEN 'reason_summary' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.finding IS NOT NULL THEN ''GLS rechaza resolver el envío; reconciliación manual requerida. No reintentar.'' WHEN ac.current THEN ac.snapshot->>''state'' ELSE ''Decisión pendiente de evidencia actual'' END ELSE p.reason_summary END AS reason_summary'
WHEN 'conversation_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.chatby_current THEN ''FOUND'' ELSE p.conversation_status END ELSE p.conversation_status END AS conversation_status'
WHEN 'conversation_freshness' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.chatby_current THEN ''FRESH'' ELSE p.conversation_freshness END ELSE p.conversation_freshness END AS conversation_freshness'
WHEN 'scoped_response_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.chatby_current THEN CASE WHEN ac.snapshot->>''milestones_superseded''=''true'' THEN ''VALID_RESPONSE'' ELSE ''NO_VALID_RESPONSE'' END ELSE ''NOT_VERIFIABLE'' END ELSE p.scoped_response_status END AS scoped_response_status'
WHEN 'scoped_response_reason' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.chatby_current THEN ''VERIFIED_ADDRESS_OWNER_READ'' ELSE ''CHATBY_CURRENT_READ_NOT_VERIFIED'' END ELSE p.scoped_response_reason END AS scoped_response_reason'
WHEN 'customer_intent' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN ac.snapshot->''input''->>''intent'' ELSE p.customer_intent END AS customer_intent'
WHEN 'dropea_freshness_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN p.last_successful_sync_at>=now()-interval ''600 seconds'' THEN ''FRESH'' ELSE ''STALE'' END ELSE p.dropea_freshness_status END AS dropea_freshness_status'
WHEN 'dropea_freshness_reason' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN p.last_successful_sync_at>=now()-interval ''600 seconds'' THEN ''WITHIN_THRESHOLD'' ELSE ''DROPEA_POLL_STALE'' END ELSE p.dropea_freshness_reason END AS dropea_freshness_reason'
WHEN 'effective_freshness_status' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.chatby_current AND p.last_successful_sync_at>=now()-interval ''600 seconds'' THEN ''FRESH'' ELSE ''STALE'' END ELSE p.effective_freshness_status END AS effective_freshness_status'
WHEN 'freshness' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.chatby_current AND p.last_successful_sync_at>=now()-interval ''600 seconds'' THEN ''FRESH'' ELSE ''STALE'' END ELSE p.freshness END AS freshness'
WHEN 'freshness_reason' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN NOT ac.chatby_current THEN ''CHATBY_CURRENT_READ_NOT_VERIFIED'' WHEN p.last_successful_sync_at>=now()-interval ''600 seconds'' THEN ''WITHIN_THRESHOLD'' ELSE ''DROPEA_POLL_STALE'' END ELSE p.freshness_reason END AS freshness_reason'
WHEN 'effective_conversation_freshness' THEN 'CASE WHEN ac.canonical_issue_id IS NOT NULL THEN CASE WHEN ac.chatby_current THEN ''FRESH'' ELSE ''STALE'' END ELSE p.effective_conversation_freshness END AS effective_conversation_freshness'
ELSE format('p.%I',a.attname) END,',' ORDER BY a.attnum) INTO columns_sql
FROM pg_attribute a WHERE a.attrelid='read_models.operations_incident_evidence_pre_address_integrity'::regclass AND a.attnum>0 AND NOT a.attisdropped;
EXECUTE format('CREATE OR REPLACE VIEW read_models.operations_incident_evidence_context AS SELECT %s,ac.snapshot->''historical_blockers'' AS historical_blockers,ac.snapshot->''current_blockers'' AS current_blockers,ac.finding AS provider_state_conflict,ac.snapshot AS address_canonical_snapshot FROM read_models.operations_incident_evidence_pre_address_integrity p LEFT JOIN read_models.address_current_context ac USING(canonical_issue_id)',columns_sql);
END $migration$;
REVOKE ALL ON read_models.operations_incident_evidence_context FROM PUBLIC;
GRANT SELECT ON read_models.operations_incident_evidence_context TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
COMMIT;


