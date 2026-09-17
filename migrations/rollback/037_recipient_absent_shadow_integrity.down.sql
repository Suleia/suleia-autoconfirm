BEGIN;
DROP VIEW read_models.operations_incident_evidence_context;
ALTER VIEW read_models.operations_incident_evidence_pre_absent_integrity RENAME TO operations_incident_evidence_context;
DROP VIEW read_models.recipient_absent_current_context;
-- Preserve append-only audit snapshots and registry records; stop materializing
-- the new projection by rolling back containers. Do not delete timers or history.
COMMIT;
