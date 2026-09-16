BEGIN;
DROP VIEW IF EXISTS read_models.operations_incident_evidence_context;
DROP VIEW IF EXISTS read_models.operations_incident_notification_scope;
ALTER TABLE operations.chatby_conversation_links DROP COLUMN IF EXISTS history_covered_from;
ALTER TABLE operations.chatby_conversation_links DROP COLUMN IF EXISTS notification_observed_at;
COMMIT;
