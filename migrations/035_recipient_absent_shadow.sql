BEGIN;
-- Extend the existing canonical incident projection, not a second decision engine.
ALTER TABLE read_models.operations_incident_records ADD COLUMN IF NOT EXISTS absent_shadow jsonb;
ALTER TABLE read_models.operations_incident_records DROP CONSTRAINT IF EXISTS absent_shadow_only_check;
ALTER TABLE read_models.operations_incident_records ADD CONSTRAINT absent_shadow_only_check CHECK (
  absent_shadow IS NULL OR COALESCE((type='RECIPIENT_ABSENT'
    AND absent_shadow->>'policy_version'='RECIPIENT_ABSENT_POLICY_V1'
    AND absent_shadow @> '{"executed":false,"external_action":false,"production_write":false}'::jsonb
    AND absent_shadow->'live_flags'='{"AUSENTE_AUTOMATION_LIVE":false,"CHATBY_REAL_SENDS":false,"DROPEA_ACTIONS_ENABLED":false,"GLS_ACTIONS_ENABLED":false}'::jsonb),false));
GRANT SELECT ON read_models.customer_operational_history,read_models.operations_data_freshness TO suleia_ingestion;
-- This view has no conversation text, identity keys or encrypted customer data.
CREATE OR REPLACE VIEW read_models.recipient_absent_shadow AS
SELECT canonical_issue_id,canonical_order_id,absent_shadow FROM read_models.operations_incident_records
WHERE type='RECIPIENT_ABSENT';
REVOKE ALL ON read_models.recipient_absent_shadow FROM PUBLIC;
GRANT SELECT ON read_models.recipient_absent_shadow TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
COMMIT;
