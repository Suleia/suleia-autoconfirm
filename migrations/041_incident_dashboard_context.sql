BEGIN;
-- Observed provider metadata for display only. No policy or provider-state changes.
ALTER TABLE read_models.operations_incident_records
  ADD COLUMN IF NOT EXISTS dashboard_source_context jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS incident_dashboard_scope_idx
  ON read_models.operations_incident_records(status,is_active,created_at DESC);
COMMIT;
