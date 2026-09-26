BEGIN;
CREATE TABLE IF NOT EXISTS operations.recipient_absent_native_control (
  workflow text PRIMARY KEY CHECK (workflow='RECIPIENT_ABSENT'),
  status text NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('DISABLED','CANARY','LIVE')),
  automation_live boolean NOT NULL DEFAULT false,
  native_send_enabled boolean NOT NULL DEFAULT false,
  template_sends_enabled boolean NOT NULL DEFAULT false,
  recipient_absent_template_cutover_at timestamptz,
  canary_issue_id text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  circuit_breaker_reason text,
  circuit_breaker_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operations.recipient_absent_native_control(workflow) VALUES('RECIPIENT_ABSENT') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS operations.recipient_absent_native_notifications (
  canonical_issue_id text NOT NULL,
  template_version text NOT NULL CHECK (template_version='dropea_ausente_v3'),
  canonical_order_id text NOT NULL,
  conversation_id text NOT NULL,
  claim_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('CLAIMED','SENT','FAILED','VERIFIED')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  message_id text UNIQUE,
  notification_at timestamptz,
  verified_at timestamptz,
  outcome jsonb,
  PRIMARY KEY(canonical_issue_id,template_version)
);
CREATE TABLE IF NOT EXISTS operations.recipient_absent_native_timers (
  timer_id uuid PRIMARY KEY,
  canonical_issue_id text NOT NULL UNIQUE,
  message_id text NOT NULL UNIQUE,
  policy_version text NOT NULL CHECK (policy_version='RECIPIENT_ABSENT_POLICY_V1'),
  timer_type text NOT NULL CHECK (timer_type='CUSTOMER_INITIAL_RESPONSE_48H'),
  started_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL CHECK (due_at=started_at+interval '48 hours')
);
REVOKE ALL ON operations.recipient_absent_native_control,operations.recipient_absent_native_notifications,operations.recipient_absent_native_timers FROM PUBLIC;
GRANT SELECT ON operations.recipient_absent_native_control,operations.recipient_absent_native_notifications,operations.recipient_absent_native_timers TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
-- Runtime can stop/reserve, but cannot enable itself or manufacture gate evidence.
GRANT UPDATE(canary_issue_id,circuit_breaker_reason,circuit_breaker_at) ON operations.recipient_absent_native_control TO suleia_ingestion;
GRANT INSERT,UPDATE ON operations.recipient_absent_native_notifications TO suleia_ingestion;
GRANT INSERT ON operations.recipient_absent_native_timers TO suleia_ingestion;
COMMIT;
