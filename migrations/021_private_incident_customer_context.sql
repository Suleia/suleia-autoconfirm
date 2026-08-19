BEGIN;

-- Customer message text is retained only as authenticated-display ciphertext.
-- MCP and generic read models never receive the clear value or the ciphertext.
CREATE TABLE IF NOT EXISTS operations.chatby_private_message_display (
  chatby_message_id_hash text NOT NULL,
  canonical_order_id text NOT NULL,
  canonical_issue_id text NOT NULL,
  direction text NOT NULL CHECK (direction='INBOUND'),
  message_type text NOT NULL,
  intent text NOT NULL DEFAULT 'UNKNOWN',
  relation_to_issue text NOT NULL CHECK (relation_to_issue IN ('BEFORE_INCIDENT','AFTER_INCIDENT')),
  message_text_ciphertext text NOT NULL CHECK (message_text_ciphertext ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed=0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes=0),
  PRIMARY KEY(canonical_issue_id,chatby_message_id_hash)
);

CREATE INDEX IF NOT EXISTS private_incident_message_issue_time_idx
  ON operations.chatby_private_message_display(canonical_issue_id,occurred_at DESC);

CREATE OR REPLACE VIEW read_models.operations_private_incident_messages AS
SELECT chatby_message_id_hash,canonical_order_id,canonical_issue_id,direction,message_type,
       intent,relation_to_issue,message_text_ciphertext,occurred_at,updated_at,
       actions_executed,production_writes
FROM operations.chatby_private_message_display;

REVOKE ALL ON operations.chatby_private_message_display FROM PUBLIC;
REVOKE ALL ON read_models.operations_private_incident_messages FROM PUBLIC;
REVOKE ALL ON operations.chatby_private_message_display FROM suleia_mcp_readonly,suleia_backup;
REVOKE ALL ON read_models.operations_private_incident_messages FROM suleia_mcp_readonly,suleia_backup;
GRANT SELECT,INSERT,UPDATE ON operations.chatby_private_message_display TO suleia_ingestion;
GRANT SELECT ON read_models.operations_private_incident_messages TO suleia_operations_readonly;

COMMIT;
