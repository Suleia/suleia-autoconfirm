BEGIN;
DROP INDEX IF EXISTS read_models.incident_dashboard_scope_idx;
ALTER TABLE read_models.operations_incident_records DROP COLUMN IF EXISTS dashboard_source_context;
COMMIT;
