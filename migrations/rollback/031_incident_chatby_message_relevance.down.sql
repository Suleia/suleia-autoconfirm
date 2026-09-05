BEGIN;

DROP VIEW IF EXISTS read_models.operations_private_incident_messages;
DROP INDEX IF EXISTS operations.private_incident_message_relevance_time_idx;
ALTER TABLE operations.chatby_private_message_display
  DROP CONSTRAINT IF EXISTS chatby_private_message_display_incident_relevance_check,
  DROP COLUMN IF EXISTS incident_relevance,
  DROP COLUMN IF EXISTS context_template_slug;

CREATE VIEW read_models.operations_private_incident_messages AS
SELECT chatby_message_id_hash,canonical_order_id,canonical_issue_id,direction,message_type,
       intent,relation_to_issue,message_text_ciphertext,occurred_at,updated_at,
       actions_executed,production_writes
FROM operations.chatby_private_message_display;

REVOKE ALL ON read_models.operations_private_incident_messages FROM PUBLIC;
REVOKE ALL ON read_models.operations_private_incident_messages FROM suleia_mcp_readonly,suleia_backup;
GRANT SELECT ON read_models.operations_private_incident_messages TO suleia_operations_readonly;

COMMIT;
