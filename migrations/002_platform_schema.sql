BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS decisions;
CREATE SCHEMA IF NOT EXISTS mcp;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS configuration;
CREATE SCHEMA IF NOT EXISTS operations;

CREATE TABLE raw.ingestion_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_record_id text NOT NULL,
  entity_type text NOT NULL,
  payload jsonb NOT NULL,
  payload_checksum text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  source_occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  masking_status text NOT NULL DEFAULT 'PENDING',
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION')
);

CREATE TABLE core.customers_masked (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference_hash text NOT NULL UNIQUE,
  display_name_masked text,
  phone_masked text,
  email_masked text,
  address_masked text,
  masking_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_id text NOT NULL UNIQUE,
  customer_id uuid REFERENCES core.customers_masked(id),
  source_status text NOT NULL DEFAULT 'UNKNOWN',
  canonical_status text NOT NULL DEFAULT 'UNKNOWN',
  currency text NOT NULL DEFAULT 'EUR',
  total_amount numeric(12,2),
  created_at_source timestamptz,
  last_source_update_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES core.orders(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_conversation_id_hash text NOT NULL,
  opened_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_conversation_id_hash)
);

CREATE TABLE core.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES core.conversations(id) ON DELETE CASCADE,
  external_message_id_hash text,
  direction text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND', 'SYSTEM')),
  message_type text NOT NULL DEFAULT 'TEXT',
  body_masked text,
  intent text NOT NULL DEFAULT 'UNKNOWN',
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, external_message_id_hash)
);

CREATE TABLE core.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  external_incident_id text NOT NULL UNIQUE,
  incident_type text NOT NULL DEFAULT 'UNKNOWN',
  status text NOT NULL DEFAULT 'PENDING',
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  latest_carrier_reason_masked text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.incident_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES core.incidents(id) ON DELETE CASCADE,
  external_history_id_hash text,
  event_type text NOT NULL,
  detail_masked text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, external_history_id_hash)
);

CREATE TABLE core.timers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES core.incidents(id) ON DELETE CASCADE,
  workflow text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED', 'COMPLETED')),
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  completed_at timestamptz,
  policy_version text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.source_freshness (
  source text PRIMARY KEY,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  latest_cursor_masked text,
  lag_seconds bigint,
  status text NOT NULL DEFAULT 'UNKNOWN',
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events.order_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES core.orders(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  source_record_id_hash text,
  schema_version integer NOT NULL DEFAULT 1,
  payload_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  trust_level text NOT NULL DEFAULT 'MEDIUM',
  freshness_status text NOT NULL DEFAULT 'FRESH',
  masking_version text NOT NULL,
  correlation_id uuid,
  causation_id uuid,
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  supersedes_event_id uuid REFERENCES events.order_events(event_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions.decision_records (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  snapshot_version text NOT NULL,
  workflow text NOT NULL,
  route text NOT NULL CHECK (route IN ('DETERMINISTIC', 'AI_REVIEW', 'HUMAN_REVIEW', 'BLOCKED')),
  proposed_action text NOT NULL,
  final_confidence numeric(5,4) NOT NULL CHECK (final_confidence BETWEEN 0 AND 1),
  reason_summary text NOT NULL,
  risk_level text NOT NULL,
  qa_status text NOT NULL,
  requires_human_review boolean NOT NULL DEFAULT false,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  policy_versions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions.decision_records(decision_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events.order_events(event_id) ON DELETE RESTRICT,
  relevance text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, event_id)
);

CREATE TABLE decisions.confidence_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions.decision_records(decision_id) ON DELETE CASCADE,
  factor text NOT NULL,
  score numeric(5,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, factor)
);

CREATE TABLE decisions.alternatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions.decision_records(decision_id) ON DELETE CASCADE,
  proposed_action text NOT NULL,
  reason text NOT NULL,
  rank integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, rank)
);

CREATE TABLE decisions.qa_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions.decision_records(decision_id) ON DELETE CASCADE,
  gate_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS', 'FAIL', 'REVIEW')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, gate_name)
);

CREATE TABLE decisions.ai_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL UNIQUE REFERENCES decisions.decision_records(decision_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions.human_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL UNIQUE REFERENCES decisions.decision_records(decision_id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'PENDING',
  assigned_to text,
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE configuration.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_name text NOT NULL,
  version text NOT NULL,
  policy_document jsonb NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  effective_from timestamptz,
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_name, version)
);

CREATE TABLE operations.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  payload_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error_masked text,
  deduplication_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE operations.idempotency_keys (
  key text PRIMARY KEY,
  operation text NOT NULL,
  result_hash text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operations.reconciliation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  entity_type text NOT NULL,
  expected_count bigint,
  actual_count bigint,
  expected_checksum text,
  actual_checksum text,
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mcp.call_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  tool_name text NOT NULL,
  principal_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  input_hash text NOT NULL,
  output_hash text,
  authorization_result text NOT NULL,
  pii_scan_result text NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  level text NOT NULL,
  event_name text NOT NULL,
  correlation_id uuid,
  payload_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_status_idx ON core.orders (canonical_status, updated_at DESC);
CREATE INDEX messages_conversation_time_idx ON core.messages (conversation_id, occurred_at DESC);
CREATE INDEX incidents_status_id_idx ON core.incidents (status, external_incident_id DESC);
CREATE INDEX timers_due_idx ON core.timers (status, deadline_at);
CREATE INDEX order_events_replay_idx ON events.order_events (order_id, occurred_at, received_at);
CREATE INDEX decisions_order_time_idx ON decisions.decision_records (order_id, created_at DESC);
CREATE INDEX human_review_pending_idx ON decisions.human_review_queue (status, priority DESC, created_at);
CREATE INDEX jobs_ready_idx ON operations.jobs (status, run_after) WHERE status = 'PENDING';
CREATE INDEX mcp_audit_time_idx ON mcp.call_audit (created_at DESC);

CREATE FUNCTION events.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events.order_events is append-only';
END;
$$;

CREATE TRIGGER order_events_immutable
BEFORE UPDATE OR DELETE ON events.order_events
FOR EACH ROW EXECUTE FUNCTION events.reject_event_mutation();

GRANT USAGE ON SCHEMA raw, core, events, decisions, configuration, operations, audit TO suleia_api;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA core, decisions, operations, audit TO suleia_api;
GRANT SELECT ON ALL TABLES IN SCHEMA events, configuration TO suleia_api;

GRANT USAGE ON SCHEMA raw, core, events, operations, audit TO suleia_ingestion;
GRANT SELECT, INSERT ON raw.ingestion_records, events.order_events TO suleia_ingestion;
GRANT SELECT, INSERT, UPDATE ON core.orders, core.customers_masked, core.conversations, core.messages,
  core.incidents, core.incident_history, core.source_freshness TO suleia_ingestion;
GRANT SELECT, INSERT, UPDATE ON operations.jobs, operations.idempotency_keys, audit.application_events TO suleia_ingestion;

GRANT USAGE ON SCHEMA core, events, decisions, configuration, operations, audit TO suleia_decision_engine;
GRANT SELECT ON ALL TABLES IN SCHEMA core, events, configuration TO suleia_decision_engine;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA decisions TO suleia_decision_engine;
GRANT SELECT, INSERT, UPDATE ON core.timers, operations.jobs, operations.idempotency_keys, audit.application_events TO suleia_decision_engine;

GRANT USAGE ON SCHEMA core, events, decisions, configuration, mcp TO suleia_mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA core, events, decisions, configuration TO suleia_mcp_readonly;
GRANT INSERT ON mcp.call_audit TO suleia_mcp_readonly;

GRANT USAGE ON SCHEMA raw, core, events, decisions, mcp, audit, configuration, operations TO suleia_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA raw, core, events, decisions, mcp, audit, configuration, operations TO suleia_backup;

ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT ON TABLES TO suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA events GRANT SELECT ON TABLES TO suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA decisions GRANT SELECT ON TABLES TO suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA configuration GRANT SELECT ON TABLES TO suleia_mcp_readonly;

COMMIT;
