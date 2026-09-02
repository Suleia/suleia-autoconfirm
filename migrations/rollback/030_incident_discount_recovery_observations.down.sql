BEGIN;

DROP VIEW IF EXISTS read_models.operations_incident_discount_recovery_latest;
DROP TABLE IF EXISTS operations.incident_discount_recovery_observations;

COMMIT;
