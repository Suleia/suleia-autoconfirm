BEGIN;

CREATE TABLE IF NOT EXISTS operations.chatby_conversation_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chatby_conversation_id_hash text NOT NULL,
  chatby_contact_id_hash text NOT NULL,
  chatby_message_id_hash text NOT NULL,
  canonical_order_id text NOT NULL,
  canonical_issue_id text,
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND','SYSTEM')),
  message_type text NOT NULL,
  template_id_hash text,
  button_payload text,
  sanitized_text text,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  source_event_id text,
  incident_version text,
  relevance_status text NOT NULL DEFAULT 'NOT_ASSESSED',
  intent text NOT NULL DEFAULT 'UNKNOWN',
  intent_confidence numeric(5,4),
  superseded_by uuid,
  payload_hash text NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  UNIQUE(chatby_message_id_hash, payload_hash)
);

CREATE TABLE IF NOT EXISTS operations.incident_intent_timeline (
  intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_issue_id text NOT NULL,
  canonical_order_id text NOT NULL,
  message_id_hash text NOT NULL,
  detected_at timestamptz NOT NULL,
  detected_intent text NOT NULL,
  confidence numeric(5,4),
  contradiction boolean NOT NULL DEFAULT false,
  supersedes_intent_id uuid,
  relevant_to_issue_version text NOT NULL,
  summary_masked text,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  UNIQUE(canonical_issue_id, relevant_to_issue_version, message_id_hash)
);

CREATE TABLE IF NOT EXISTS operations.incident_timers (
  timer_id text PRIMARY KEY,
  canonical_order_id text NOT NULL,
  canonical_issue_id text NOT NULL,
  issue_version text NOT NULL,
  source_event_id text NOT NULL,
  timer_type text NOT NULL CHECK (timer_type IN (
    'CUSTOMER_INITIAL_RESPONSE_48H','CUSTOMER_DISCOUNT_RESPONSE_48H','DROPEA_CONFIRMATION_WAIT',
    'COD_CHANGE_WAIT','RETURN_COMPLETION_WAIT','OPERATION_VERIFICATION','RECONCILIATION','GLS_RETENTION_DEADLINE'
  )),
  started_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED','SUPERSEDED','EXPIRED')),
  policy_version text NOT NULL,
  superseded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  UNIQUE(canonical_issue_id, issue_version, timer_type, source_event_id)
);

CREATE TABLE IF NOT EXISTS operations.incident_simulation_decisions (
  simulation_id text PRIMARY KEY,
  canonical_issue_id text NOT NULL,
  canonical_order_id text NOT NULL,
  issue_version text NOT NULL,
  source_event_id text NOT NULL,
  dropea_snapshot_at timestamptz NOT NULL,
  chatby_snapshot_at timestamptz,
  policy_version text NOT NULL,
  connector_version text NOT NULL,
  issue_type text NOT NULL,
  delivery_attempt_number text NOT NULL DEFAULT 'UNKNOWN',
  customer_has_replied boolean NOT NULL,
  customer_intent text NOT NULL,
  interpretation_summary text NOT NULL,
  facts_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts_ignored jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_resolution_options text[] NOT NULL DEFAULT '{}',
  gls_feasibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  simulated_decision text NOT NULL,
  simulated_action jsonb,
  missing_data text[] NOT NULL DEFAULT '{}',
  blocking_reasons text[] NOT NULL DEFAULT '{}',
  risk text NOT NULL,
  confidence numeric(5,4),
  qa_status text NOT NULL,
  human_review boolean NOT NULL,
  timer_status text,
  execution_available boolean NOT NULL DEFAULT false CHECK (execution_available = false),
  external_write_attempted boolean NOT NULL DEFAULT false CHECK (external_write_attempted = false),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE(canonical_issue_id, issue_version, source_event_id, policy_version)
);

CREATE TABLE IF NOT EXISTS operations.incident_discount_workflow (
  workflow_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_issue_id text NOT NULL UNIQUE,
  canonical_order_id text NOT NULL,
  status text NOT NULL,
  eligible_at timestamptz,
  offer_prepared_at timestamptz,
  customer_response_at timestamptz,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount IN (0,5)),
  timer_id text,
  policy_version text NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE read_models.operations_incident_records
  ADD COLUMN IF NOT EXISTS raw_type text,
  ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'MAPPED',
  ADD COLUMN IF NOT EXISTS schema_drift_alert boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolution_data_present boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolution_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

CREATE TABLE IF NOT EXISTS read_models.operations_incident_interpretations (
  canonical_issue_id text PRIMARY KEY,
  canonical_order_id text NOT NULL,
  issue_version text NOT NULL,
  has_customer_replied boolean NOT NULL DEFAULT false,
  latest_inbound_message_at timestamptz,
  latest_relevant_message_hash text,
  customer_intent text NOT NULL DEFAULT 'NO_RESPONSE',
  previous_intents text[] NOT NULL DEFAULT '{}',
  intent_changed boolean NOT NULL DEFAULT false,
  contradiction boolean NOT NULL DEFAULT false,
  requested_date date,
  requested_time_window text,
  requested_detail_masked text,
  requested_address_present boolean NOT NULL DEFAULT false,
  pickup_requested boolean NOT NULL DEFAULT false,
  return_requested boolean NOT NULL DEFAULT false,
  discount_accepted boolean NOT NULL DEFAULT false,
  discount_rejected boolean NOT NULL DEFAULT false,
  conversation_quality text NOT NULL DEFAULT 'NO_RESPONSE',
  interpretation_confidence numeric(5,4),
  interpretation_summary text NOT NULL,
  messages_used integer NOT NULL DEFAULT 0,
  messages_ignored integer NOT NULL DEFAULT 0,
  missing_information text[] NOT NULL DEFAULT '{}',
  freshness text NOT NULL DEFAULT 'UNKNOWN',
  updated_at timestamptz NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE OR REPLACE VIEW read_models.operations_incident_handbook_detail AS
SELECT i.*, x.has_customer_replied, x.latest_inbound_message_at,
       x.latest_relevant_message_hash, x.customer_intent AS detected_intent,
       x.previous_intents, x.intent_changed, x.contradiction,
       x.requested_date, x.requested_time_window, x.requested_detail_masked,
       x.requested_address_present, x.pickup_requested, x.return_requested,
       x.discount_accepted, x.discount_rejected, x.conversation_quality,
       x.interpretation_confidence AS conversation_confidence,
       x.interpretation_summary, x.messages_used, x.messages_ignored,
       x.missing_information,
       d.payload_masked AS decision_payload_masked, d.policy_version AS decision_policy_version,
       d.reason_codes, d.dropea_validation, d.gls_feasibility,
       d.confidence AS decision_confidence, d.requires_human_review,
       w.original_amount, w.discount_amount, w.new_amount, w.offer_created_at,
       w.response_status AS discount_response_status, w.accepted_at AS discount_accepted_at,
       w.email_prepared, w.email_sent, w.dropea_status AS discount_dropea_status,
       w.cod_change_verified, w.ready_for_retry
FROM read_models.operations_incident_records i
LEFT JOIN read_models.operations_incident_interpretations x USING (canonical_issue_id)
LEFT JOIN read_models.operations_decision_cards d ON d.decision_id = i.decision_id
LEFT JOIN read_models.operations_discount_workflows w ON w.canonical_order_id = i.canonical_order_id;

CREATE INDEX IF NOT EXISTS chatby_events_issue_time_idx ON operations.chatby_conversation_events(canonical_issue_id, occurred_at);
CREATE INDEX IF NOT EXISTS incident_intent_issue_time_idx ON operations.incident_intent_timeline(canonical_issue_id, detected_at);
CREATE INDEX IF NOT EXISTS incident_timers_due_idx ON operations.incident_timers(status, due_at);
CREATE INDEX IF NOT EXISTS incident_decisions_issue_time_idx ON operations.incident_simulation_decisions(canonical_issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS incident_interpretation_freshness_idx ON read_models.operations_incident_interpretations(freshness, updated_at DESC);

GRANT SELECT, INSERT, UPDATE ON operations.chatby_conversation_events,
  operations.incident_intent_timeline, operations.incident_timers,
  operations.incident_simulation_decisions, operations.incident_discount_workflow
TO suleia_ingestion;
GRANT SELECT ON operations.chatby_conversation_events, operations.incident_intent_timeline,
  operations.incident_timers, operations.incident_simulation_decisions,
  operations.incident_discount_workflow TO suleia_backup;
GRANT SELECT, INSERT, UPDATE ON read_models.operations_incident_interpretations TO suleia_ingestion;
GRANT SELECT ON read_models.operations_incident_interpretations TO suleia_operations_readonly, suleia_mcp_readonly, suleia_backup;
GRANT SELECT ON read_models.operations_incident_handbook_detail TO suleia_operations_readonly, suleia_mcp_readonly, suleia_backup;

COMMIT;
