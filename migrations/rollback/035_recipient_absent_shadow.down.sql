BEGIN;
DROP VIEW IF EXISTS read_models.recipient_absent_shadow;
ALTER TABLE read_models.operations_incident_records DROP CONSTRAINT IF EXISTS absent_shadow_only_check;
ALTER TABLE read_models.operations_incident_records DROP COLUMN IF EXISTS absent_shadow;
COMMIT;
