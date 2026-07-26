BEGIN;

CREATE TABLE raw.ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  received_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  cursor_masked text,
  checksum text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION')
);

CREATE TABLE raw.source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES raw.ingestion_batches(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_record_id_hash text NOT NULL,
  entity_type text NOT NULL,
  payload_masked jsonb NOT NULL,
  checksum text NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_record_id_hash, checksum)
);

CREATE TABLE raw.ingestion_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES raw.ingestion_batches(id) ON DELETE CASCADE,
  source_record_id_hash text,
  error_code text NOT NULL,
  error_detail_masked text,
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.order_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_order_id_hash text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_order_id_hash)
);

CREATE TABLE core.order_digital_twins (
  order_id uuid PRIMARY KEY REFERENCES core.orders(id) ON DELETE CASCADE,
  snapshot_version text NOT NULL,
  twin_document jsonb NOT NULL,
  completeness numeric(5,4) NOT NULL CHECK (completeness BETWEEN 0 AND 1),
  freshness_status text NOT NULL,
  contradiction_count integer NOT NULL DEFAULT 0,
  policy_versions text[] NOT NULL DEFAULT '{}',
  built_at timestamptz NOT NULL DEFAULT now(),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION')
);

CREATE TABLE core.order_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  snapshot_version text NOT NULL,
  twin_document jsonb NOT NULL,
  event_high_watermark timestamptz NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, snapshot_version)
);

CREATE TABLE core.customer_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES core.customers_masked(id) ON DELETE CASCADE,
  source text NOT NULL,
  alias_hash text NOT NULL,
  alias_type text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, alias_type, alias_hash)
);

CREATE TABLE events.event_deduplication (
  deduplication_key text PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events.order_events(event_id) ON DELETE RESTRICT,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events.event_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_event_id uuid NOT NULL REFERENCES events.order_events(event_id) ON DELETE RESTRICT,
  correction_event_id uuid NOT NULL UNIQUE REFERENCES events.order_events(event_id) ON DELETE RESTRICT,
  reason_masked text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events.event_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  through_event_id uuid NOT NULL REFERENCES events.order_events(event_id) ON DELETE RESTRICT,
  state_masked jsonb NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, through_event_id)
);

CREATE TABLE events.replay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES core.orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  from_timestamp timestamptz,
  to_timestamp timestamptz,
  event_count integer NOT NULL DEFAULT 0,
  result_checksum text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION')
);

CREATE TABLE decisions.simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  snapshot_version text NOT NULL,
  policy_versions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'PENDING',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION')
);

CREATE TABLE decisions.agent_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id uuid NOT NULL REFERENCES decisions.simulation_runs(id) ON DELETE CASCADE,
  route text NOT NULL,
  proposed_action text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason_summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id uuid NOT NULL REFERENCES decisions.simulation_runs(id) ON DELETE CASCADE,
  decision_record_id uuid REFERENCES decisions.decision_records(decision_id) ON DELETE SET NULL,
  selected_action text NOT NULL,
  selected_by text NOT NULL DEFAULT 'DETERMINISTIC_ENGINE',
  status text NOT NULL DEFAULT 'SIMULATED',
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions.decision_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions.decisions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events.order_events(event_id) ON DELETE RESTRICT,
  relevance text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, event_id)
);

CREATE TABLE decisions.decision_alternatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions.decisions(id) ON DELETE CASCADE,
  proposed_action text NOT NULL,
  reason text NOT NULL,
  rank integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, rank)
);

CREATE TABLE decisions.review_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions.decisions(id) ON DELETE CASCADE,
  review_type text NOT NULL CHECK (review_type IN ('AI_REVIEW', 'HUMAN_REVIEW')),
  reviewer_hash text NOT NULL,
  selection text NOT NULL,
  notes_masked text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION')
);

CREATE TABLE decisions.simulation_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES core.orders(id) ON DELETE CASCADE,
  simulation_run_id uuid NOT NULL REFERENCES decisions.simulation_runs(id) ON DELETE CASCADE,
  current_system_decision_masked jsonb,
  simulated_decision_masked jsonb NOT NULL,
  matches boolean,
  discrepancy_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE decisions.ai_review_queue
  ADD COLUMN order_id uuid REFERENCES core.orders(id) ON DELETE CASCADE,
  ADD COLUMN snapshot_version text,
  ADD COLUMN reason_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN risk_level text NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN freshness_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN policy_gaps text[] NOT NULL DEFAULT '{}',
  ADD COLUMN masked_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN evidence_event_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN assigned_reviewer text,
  ADD COLUMN review_notes text,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN final_selection text,
  ADD COLUMN actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  ADD COLUMN run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  ADD CONSTRAINT ai_review_queue_status_check
    CHECK (status IN ('PENDING', 'CLAIMED', 'IN_REVIEW', 'COMPLETED', 'DISMISSED', 'BLOCKED'));

ALTER TABLE decisions.human_review_queue
  ADD COLUMN order_id uuid REFERENCES core.orders(id) ON DELETE CASCADE,
  ADD COLUMN snapshot_version text,
  ADD COLUMN reason_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN risk_level text NOT NULL DEFAULT 'HIGH',
  ADD COLUMN confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN freshness_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN policy_gaps text[] NOT NULL DEFAULT '{}',
  ADD COLUMN masked_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN evidence_event_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN final_selection text,
  ADD COLUMN actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  ADD COLUMN run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  ADD CONSTRAINT human_review_queue_status_check
    CHECK (status IN ('PENDING', 'CLAIMED', 'IN_REVIEW', 'COMPLETED', 'DISMISSED', 'BLOCKED'));

CREATE TABLE mcp.tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  client_id uuid,
  tool_name text NOT NULL,
  input_hash text NOT NULL,
  output_hash text,
  status text NOT NULL,
  duration_ms integer,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mcp.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL UNIQUE,
  principal_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE mcp.scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES mcp.clients(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('orders:read', 'orders:simulate')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, scope)
);

ALTER TABLE mcp.tool_executions
  ADD CONSTRAINT tool_executions_client_fk
  FOREIGN KEY (client_id) REFERENCES mcp.clients(id) ON DELETE SET NULL;

CREATE TABLE mcp.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  principal_hash text,
  event_type text NOT NULL,
  severity text NOT NULL,
  detail_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.data_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_hash text NOT NULL,
  resource_type text NOT NULL,
  resource_id_hash text,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  severity text NOT NULL,
  event_type text NOT NULL,
  payload_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE audit.masking_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id_hash text NOT NULL,
  masking_version text NOT NULL,
  fields_redacted text[] NOT NULL DEFAULT '{}',
  pii_scan_result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES core.orders(id) ON DELETE SET NULL,
  proposed_action text NOT NULL,
  authorization_status text NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE configuration.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_name text NOT NULL UNIQUE,
  description text NOT NULL,
  owner text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE configuration.policy_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES configuration.policies(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES configuration.policy_versions(id) ON DELETE CASCADE,
  workflow text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow, status)
);

CREATE TABLE configuration.freshness_thresholds (
  source text PRIMARY KEY,
  warning_seconds bigint NOT NULL,
  stale_seconds bigint NOT NULL,
  policy_version text NOT NULL,
  CHECK (warning_seconds > 0 AND stale_seconds > warning_seconds)
);

CREATE TABLE configuration.feature_flags (
  flag_name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'staging',
  reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE configuration.system_settings (
  setting_name text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  environment text NOT NULL DEFAULT 'staging',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operations.job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES operations.jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  worker_id text,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_masked text,
  UNIQUE (job_id, attempt)
);

CREATE TABLE operations.dead_letter_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES operations.jobs(id) ON DELETE SET NULL,
  job_type text NOT NULL,
  payload_masked jsonb NOT NULL,
  failure_reason_masked text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE operations.system_locks (
  lock_name text PRIMARY KEY,
  owner_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > acquired_at)
);

ALTER TABLE core.timers DROP CONSTRAINT IF EXISTS timers_status_check;
ALTER TABLE core.timers
  ADD COLUMN timer_type text NOT NULL DEFAULT 'WORKFLOW',
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN resumed_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN expired_at timestamptz,
  ADD COLUMN source_event_id uuid REFERENCES events.order_events(event_id) ON DELETE RESTRICT,
  ADD COLUMN reason text,
  ADD COLUMN run_mode text NOT NULL DEFAULT 'SIMULATION' CHECK (run_mode = 'SIMULATION'),
  ADD CONSTRAINT timers_status_check
    CHECK (status IN ('PENDING', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED', 'COMPLETED'));

CREATE INDEX source_records_batch_idx ON raw.source_records (batch_id, received_at);
CREATE INDEX source_links_order_idx ON core.order_source_links (order_id, source);
CREATE INDEX snapshots_order_time_idx ON core.order_snapshots (order_id, created_at DESC);
CREATE INDEX replay_runs_order_idx ON events.replay_runs (order_id, started_at DESC);
CREATE INDEX simulation_runs_order_idx ON decisions.simulation_runs (order_id, started_at DESC);
CREATE INDEX ai_review_pending_idx ON decisions.ai_review_queue (status, created_at);
CREATE INDEX tool_executions_time_idx ON mcp.tool_executions (created_at DESC);
CREATE INDEX dead_letter_unresolved_idx ON operations.dead_letter_queue (failed_at) WHERE resolved_at IS NULL;

GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA raw, events TO suleia_ingestion;
GRANT SELECT, INSERT, UPDATE ON core.order_source_links, core.order_digital_twins,
  core.order_snapshots, core.customer_aliases TO suleia_ingestion;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA decisions TO suleia_decision_engine;
GRANT SELECT, INSERT, UPDATE ON operations.job_runs, operations.dead_letter_queue,
  operations.system_locks TO suleia_decision_engine;
GRANT SELECT, INSERT ON mcp.tool_executions, mcp.security_events TO suleia_mcp_readonly;
GRANT SELECT ON mcp.clients, mcp.scopes TO suleia_mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA raw, core, events, decisions, mcp, audit,
  configuration, operations TO suleia_backup;

COMMIT;
