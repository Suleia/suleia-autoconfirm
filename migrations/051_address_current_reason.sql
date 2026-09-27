BEGIN;
CREATE OR REPLACE FUNCTION read_models.address_decision_reason(record_status text, decision_current boolean, persisted_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $reason$
 SELECT CASE WHEN record_status='CURRENT' AND decision_current AND persisted_status='PERSISTED'
 THEN 'La decisión corresponde a la incidencia, evidencia y política actuales.'
 ELSE 'La decisión necesita una nueva verificación de incidencia, evidencia y política.' END
$reason$;
DO $migration$ DECLARE columns_sql text; BEGIN
IF to_regclass('read_models.operations_incident_evidence_pre_address_reason') IS NULL THEN
 ALTER VIEW read_models.operations_incident_evidence_context RENAME TO operations_incident_evidence_pre_address_reason;
END IF;
SELECT string_agg(CASE WHEN a.attname='decision_status_reason' THEN
 'CASE WHEN p.address_canonical_snapshot IS NOT NULL THEN read_models.address_decision_reason(p.decision_record_status,p.notification_decision_current,p.snapshot_status) ELSE p.decision_status_reason END AS decision_status_reason'
 ELSE format('p.%I',a.attname) END,',' ORDER BY a.attnum) INTO columns_sql
FROM pg_attribute a WHERE a.attrelid='read_models.operations_incident_evidence_pre_address_reason'::regclass AND a.attnum>0 AND NOT a.attisdropped;
EXECUTE format('CREATE OR REPLACE VIEW read_models.operations_incident_evidence_context AS SELECT %s FROM read_models.operations_incident_evidence_pre_address_reason p',columns_sql);
END $migration$;
REVOKE ALL ON read_models.operations_incident_evidence_context FROM PUBLIC;
GRANT SELECT ON read_models.operations_incident_evidence_context TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
COMMIT;
