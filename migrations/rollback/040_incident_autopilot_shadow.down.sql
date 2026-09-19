BEGIN;
DROP VIEW IF EXISTS read_models.operations_incident_autopilot_current;
DROP TABLE IF EXISTS operations.incident_action_verifications;
DROP TABLE IF EXISTS operations.incident_human_review_queue;
DROP TABLE IF EXISTS operations.incident_action_outbox;
DROP TABLE IF EXISTS operations.incident_autopilot_transitions;
DROP TABLE IF EXISTS operations.incident_autopilot_cases;
COMMIT;
