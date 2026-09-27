BEGIN;
CREATE TABLE IF NOT EXISTS operations.recipient_absent_resolutions (
  canonical_issue_id text PRIMARY KEY,
  canonical_order_id text NOT NULL,
  response_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  resolution_hash text NOT NULL,
  structured jsonb NOT NULL,
  policy_version text NOT NULL CHECK (policy_version='RECIPIENT_ABSENT_RESOLUTION_V1'),
  status text NOT NULL CHECK (status IN ('CLAIMED','APPLIED','UNVERIFIED','ABORTED')),
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (structured ?| ARRAY['phone','verified_phone','resolution_text','resolution_note','value']))
);
-- One-shot Dropea transitions: even a new response cannot bypass an existing
-- issue claim. A crash/timeout stays claimed until manual reconciliation.
REVOKE ALL ON operations.recipient_absent_resolutions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON operations.recipient_absent_resolutions TO suleia_ingestion;
GRANT SELECT ON operations.recipient_absent_resolutions TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
CREATE TABLE IF NOT EXISTS operations.recipient_absent_resolution_control (
  workflow text PRIMARY KEY CHECK (workflow='RECIPIENT_ABSENT'),
  status text NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('DISABLED','CANARY','LIVE')),
  activation_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  canary_issue_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operations.recipient_absent_resolution_control(workflow) VALUES('RECIPIENT_ABSENT') ON CONFLICT DO NOTHING;
REVOKE ALL ON operations.recipient_absent_resolution_control FROM PUBLIC;
GRANT SELECT ON operations.recipient_absent_resolution_control TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
-- The worker may reserve the single canary slot, never enable itself.
GRANT UPDATE(canary_issue_id) ON operations.recipient_absent_resolution_control TO suleia_ingestion;
COMMIT;
