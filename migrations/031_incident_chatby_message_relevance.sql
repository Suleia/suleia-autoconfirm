BEGIN;

ALTER TABLE operations.chatby_private_message_display
  ADD COLUMN IF NOT EXISTS context_template_slug text,
  ADD COLUMN IF NOT EXISTS incident_relevance text NOT NULL DEFAULT 'INCIDENT_RELEVANT';

ALTER TABLE operations.chatby_private_message_display
  DROP CONSTRAINT IF EXISTS chatby_private_message_display_incident_relevance_check;
ALTER TABLE operations.chatby_private_message_display
  ADD CONSTRAINT chatby_private_message_display_incident_relevance_check
  CHECK (incident_relevance IN (
    'BEFORE_INCIDENT','INCIDENT_RELEVANT','ORDER_LIFECYCLE_ONLY','DISCOUNT_RESPONSE'
  ));

UPDATE operations.chatby_private_message_display
SET incident_relevance='BEFORE_INCIDENT'
WHERE relation_to_issue='BEFORE_INCIDENT'
  AND incident_relevance<>'BEFORE_INCIDENT';

CREATE INDEX IF NOT EXISTS private_incident_message_relevance_time_idx
  ON operations.chatby_private_message_display(
    canonical_issue_id,incident_relevance,occurred_at DESC
  );

CREATE OR REPLACE VIEW read_models.operations_private_incident_messages AS
SELECT chatby_message_id_hash,canonical_order_id,canonical_issue_id,direction,message_type,
       intent,relation_to_issue,message_text_ciphertext,occurred_at,updated_at,
       actions_executed,production_writes,context_template_slug,incident_relevance
FROM operations.chatby_private_message_display;

REVOKE ALL ON read_models.operations_private_incident_messages FROM PUBLIC;
REVOKE ALL ON read_models.operations_private_incident_messages FROM suleia_mcp_readonly,suleia_backup;
GRANT SELECT ON read_models.operations_private_incident_messages TO suleia_operations_readonly;

COMMENT ON COLUMN operations.chatby_private_message_display.incident_relevance IS
  'Exact-order incident context. ORDER_LIFECYCLE_ONLY excludes initial order-template actions from incident decisions.';

COMMIT;
