BEGIN;
-- Keep every unrelated column and workflow from the previous read model.
DO $migration$
DECLARE columns_sql text;
BEGIN
 IF to_regclass('read_models.operations_incident_evidence_pre_absent_closure') IS NULL THEN
  ALTER VIEW read_models.operations_incident_evidence_context RENAME TO operations_incident_evidence_pre_absent_closure;
 END IF;
 SELECT string_agg(CASE a.attname
  WHEN 'decision_record_status' THEN 'CASE WHEN ac.canonical_issue_id IS NULL THEN p.decision_record_status WHEN ac.current THEN ''CURRENT'' WHEN EXISTS(SELECT 1 FROM operations.recipient_absent_decision_snapshots newer WHERE newer.supersedes_decision_id=ac.shadow->>''decision_id'') THEN ''SUPERSEDED'' ELSE ''HISTORICAL'' END AS decision_record_status'
  WHEN 'decision_status_reason' THEN 'CASE WHEN ac.canonical_issue_id IS NULL THEN p.decision_status_reason WHEN ac.current THEN ''La decisión corresponde a la entrada y política actuales'' ELSE ''La decisión no corresponde a la entrada actual; requiere revalidación'' END AS decision_status_reason'
  ELSE format('p.%I',a.attname) END,',' ORDER BY a.attnum) INTO columns_sql
 FROM pg_attribute a WHERE a.attrelid='read_models.operations_incident_evidence_pre_absent_closure'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 EXECUTE format('CREATE OR REPLACE VIEW read_models.operations_incident_evidence_context AS SELECT %s FROM read_models.operations_incident_evidence_pre_absent_closure p LEFT JOIN read_models.recipient_absent_current_context ac USING(canonical_issue_id,canonical_order_id)',columns_sql);
END $migration$;
REVOKE ALL ON read_models.operations_incident_evidence_context FROM PUBLIC;
GRANT SELECT ON read_models.operations_incident_evidence_context TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
-- A circuit breaker can stop this workflow, but this role still cannot enable it.
ALTER TABLE operations.recipient_absent_resolution_control ADD COLUMN IF NOT EXISTS circuit_breaker_reason text;
ALTER TABLE operations.recipient_absent_resolution_control ADD COLUMN IF NOT EXISTS circuit_breaker_at timestamptz;
GRANT UPDATE(circuit_breaker_reason,circuit_breaker_at) ON operations.recipient_absent_resolution_control TO suleia_ingestion;
CREATE OR REPLACE VIEW read_models.recipient_absent_execution_audit AS
SELECT canonical_issue_id,canonical_order_id,response_id,idempotency_key,resolution_hash,structured,
 CASE status WHEN 'CLAIMED' THEN 'REQUESTED' WHEN 'APPLIED' THEN 'VERIFIED' WHEN 'ABORTED' THEN 'FAILED' ELSE 'UNKNOWN' END AS verification_status,
 status,created_at,updated_at,outcome
FROM operations.recipient_absent_resolutions;
GRANT SELECT ON read_models.recipient_absent_execution_audit TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
COMMIT;
