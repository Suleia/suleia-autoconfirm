BEGIN;
DROP VIEW IF EXISTS read_models.operations_incident_handbook_detail;
DROP TABLE IF EXISTS read_models.operations_incident_interpretations;
ALTER TABLE read_models.operations_incident_records
  DROP COLUMN IF EXISTS raw_type,
  DROP COLUMN IF EXISTS mapping_status,
  DROP COLUMN IF EXISTS schema_drift_alert,
  DROP COLUMN IF EXISTS resolution_status,
  DROP COLUMN IF EXISTS resolution_data_present,
  DROP COLUMN IF EXISTS resolution_changed_at,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS source_event_id,
  DROP COLUMN IF EXISTS observed_at;
DROP TABLE IF EXISTS operations.incident_discount_workflow;
DROP TABLE IF EXISTS operations.incident_simulation_decisions;
DROP TABLE IF EXISTS operations.incident_timers;
DROP TABLE IF EXISTS operations.incident_intent_timeline;
DROP TABLE IF EXISTS operations.chatby_conversation_events;
COMMIT;
