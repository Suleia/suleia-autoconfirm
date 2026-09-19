BEGIN;

CREATE TABLE IF NOT EXISTS operations.incident_autopilot_cases (
  canonical_issue_id text PRIMARY KEY,
  canonical_order_id text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'DETECTED','CONTEXT_LOADING','READY_FOR_DECISION','ACTION_PENDING','ACTION_EXECUTING',
    'ACTION_VERIFYING','WAITING_CUSTOMER','WAITING_TIMER','CUSTOMER_ACTED','RECOVERABLE_NOW',
    'WAITING_REDELIVERY','WAITING_EXTERNAL_CONFIRMATION','RECOVERED','RETURN_ELIGIBLE',
    'RETURN_PENDING','RETURNED','RESOLVED','HUMAN_REVIEW','BLOCKED','ERROR'
  )),
  mode text NOT NULL CHECK (mode IN ('SIMULATION','SHADOW_READ_ONLY','PAUSED')),
  policy_name text NOT NULL,
  policy_version text NOT NULL,
  decision_id text,
  next_action text,
  reason text NOT NULL,
  waiting_for text,
  due_at timestamptz,
  human_review boolean NOT NULL DEFAULT false,
  error_code text,
  source_snapshot_hash text NOT NULL,
  updated_at timestamptz NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE TABLE IF NOT EXISTS operations.incident_autopilot_transitions (
  transition_id text PRIMARY KEY,
  canonical_issue_id text NOT NULL REFERENCES operations.incident_autopilot_cases(canonical_issue_id),
  from_state text NOT NULL,
  to_state text NOT NULL,
  occurred_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_name text NOT NULL,
  policy_version text NOT NULL,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  decision_id text,
  action_id text,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE TABLE IF NOT EXISTS operations.incident_action_outbox (
  action_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  canonical_order_id text NOT NULL,
  canonical_issue_id text NOT NULL REFERENCES operations.incident_autopilot_cases(canonical_issue_id),
  action_type text NOT NULL CHECK (action_type IN (
    'SEND_CHATBY_TEMPLATE','SEND_CHATBY_MESSAGE','REQUEST_REDELIVERY','UPDATE_DELIVERY_DATA',
    'APPLY_DISCOUNT','REQUEST_AGENCY_PICKUP','REQUEST_RETURN','RESOLVE_INCIDENT'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  executed_at timestamptz,
  status text NOT NULL CHECK (status IN ('SIMULATED','BLOCKED','CANCELLED')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  mode text NOT NULL CHECK (mode IN ('SIMULATION','SHADOW','PAUSED')),
  provider text NOT NULL,
  provider_response jsonb,
  verification_status text NOT NULL DEFAULT 'NOT_STARTED',
  policy_name text NOT NULL,
  policy_version text NOT NULL,
  external_write_attempted boolean NOT NULL DEFAULT false CHECK (external_write_attempted = false),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE TABLE IF NOT EXISTS operations.incident_action_verifications (
  verification_id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES operations.incident_action_outbox(action_id),
  canonical_issue_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','VERIFIED','FAILED')),
  checked_at timestamptz NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed jsonb,
  reason text NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE TABLE IF NOT EXISTS operations.incident_human_review_queue (
  canonical_issue_id text PRIMARY KEY REFERENCES operations.incident_autopilot_cases(canonical_issue_id),
  reason_code text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE INDEX IF NOT EXISTS incident_autopilot_state_idx
  ON operations.incident_autopilot_cases(state, updated_at DESC);
CREATE INDEX IF NOT EXISTS incident_autopilot_due_idx
  ON operations.incident_autopilot_cases(due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS incident_action_outbox_status_idx
  ON operations.incident_action_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS incident_human_review_status_idx
  ON operations.incident_human_review_queue(status, updated_at DESC);

CREATE OR REPLACE VIEW read_models.operations_incident_autopilot_current AS
SELECT c.*, i.status AS incident_status, i.is_active, i.type AS incident_type,
  i.carrier, i.created_at AS incident_created_at, i.updated_at AS incident_updated_at,
  a.action_id, a.action_type, a.status AS action_status, a.mode AS action_mode,
  a.verification_status
FROM operations.incident_autopilot_cases c
JOIN read_models.operations_incident_records i USING(canonical_issue_id,canonical_order_id)
LEFT JOIN LATERAL (
  SELECT * FROM operations.incident_action_outbox o
  WHERE o.canonical_issue_id=c.canonical_issue_id
  ORDER BY o.created_at DESC LIMIT 1
) a ON true;

REVOKE ALL ON operations.incident_autopilot_cases, operations.incident_autopilot_transitions,
  operations.incident_action_outbox, operations.incident_action_verifications,
  operations.incident_human_review_queue, read_models.operations_incident_autopilot_current FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON operations.incident_autopilot_cases,
  operations.incident_autopilot_transitions, operations.incident_action_outbox,
  operations.incident_action_verifications, operations.incident_human_review_queue TO suleia_ingestion;
GRANT SELECT ON operations.incident_autopilot_cases, operations.incident_autopilot_transitions,
  operations.incident_action_outbox, operations.incident_action_verifications,
  operations.incident_human_review_queue, read_models.operations_incident_autopilot_current
  TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;

COMMIT;
