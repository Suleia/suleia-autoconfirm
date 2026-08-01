BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_operations_readonly') THEN
    CREATE ROLE suleia_operations_readonly NOLOGIN;
  END IF;
END
$$;
ALTER ROLE suleia_operations_readonly SET default_transaction_read_only = on;

CREATE TABLE IF NOT EXISTS read_models.operations_order_records (
  canonical_order_id text PRIMARY KEY,
  dropea_order_id text NOT NULL,
  external_order_id_hash text,
  status text NOT NULL,
  sub_status text,
  canonical_state text NOT NULL,
  product_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_amount numeric(14,2),
  currency text,
  carrier text,
  service_type text,
  tracking_reference_masked text,
  identity_status text NOT NULL,
  decision_status text NOT NULL DEFAULT 'NOT_ASSESSED',
  risk text NOT NULL DEFAULT 'NOT_ASSESSED',
  priority text NOT NULL DEFAULT 'NORMAL',
  freshness text NOT NULL DEFAULT 'UNKNOWN',
  latest_message_at timestamptz,
  updated_at timestamptz NOT NULL,
  source_version text NOT NULL,
  schema_version text NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  run_mode text NOT NULL DEFAULT 'SHADOW_READ_ONLY' CHECK (run_mode = 'SHADOW_READ_ONLY')
);

CREATE TABLE IF NOT EXISTS read_models.operations_incident_records (
  canonical_issue_id text PRIMARY KEY,
  dropea_issue_id text NOT NULL,
  canonical_order_id text NOT NULL,
  dropea_order_id text,
  type text NOT NULL,
  status text NOT NULL,
  is_active boolean NOT NULL,
  actionable boolean NOT NULL,
  carrier text NOT NULL,
  tracking_reference_masked text,
  initial_carrier_code text,
  initial_carrier_description_sanitized text,
  initial_carrier_substatus_code text,
  allowed_resolution_options text[] NOT NULL DEFAULT '{}',
  pickup_point_masked jsonb,
  delivery_attempt_number text NOT NULL DEFAULT 'UNKNOWN',
  carrier_retention_deadline timestamptz,
  customer_response_status text NOT NULL DEFAULT 'UNKNOWN',
  customer_intent text NOT NULL DEFAULT 'UNKNOWN',
  proposed_resolution text,
  decision_id text,
  policy_id text,
  confidence numeric(5,4),
  risk text NOT NULL DEFAULT 'NOT_ASSESSED',
  priority text NOT NULL DEFAULT 'NORMAL',
  qa_result text NOT NULL DEFAULT 'PENDING',
  blocking_reasons text[] NOT NULL DEFAULT '{}',
  due_at timestamptz,
  discount_status text NOT NULL DEFAULT 'NOT_OFFERED',
  freshness text NOT NULL DEFAULT 'UNKNOWN',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  run_mode text NOT NULL DEFAULT 'SHADOW_READ_ONLY' CHECK (run_mode = 'SHADOW_READ_ONLY')
);

CREATE TABLE IF NOT EXISTS read_models.operations_conversation_summaries (
  canonical_order_id text PRIMARY KEY,
  has_customer_replied boolean NOT NULL DEFAULT false,
  latest_inbound_message_at timestamptz,
  latest_relevant_message_hash text,
  detected_intent text NOT NULL DEFAULT 'UNKNOWN',
  requested_date date,
  requested_time_window text,
  address_change_detected boolean NOT NULL DEFAULT false,
  refusal_detected boolean NOT NULL DEFAULT false,
  acceptance_detected boolean NOT NULL DEFAULT false,
  discount_accepted boolean NOT NULL DEFAULT false,
  change_of_intent boolean NOT NULL DEFAULT false,
  contradiction text NOT NULL DEFAULT 'NONE',
  confidence numeric(5,4),
  messages_used integer NOT NULL DEFAULT 0,
  messages_ignored integer NOT NULL DEFAULT 0,
  explanation_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness text NOT NULL DEFAULT 'UNKNOWN',
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS read_models.operations_decision_cards (
  decision_id text PRIMARY KEY,
  canonical_order_id text NOT NULL,
  canonical_issue_id text,
  proposal text NOT NULL,
  payload_masked jsonb,
  policy_version text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  dropea_validation text NOT NULL DEFAULT 'NOT_ASSESSED',
  gls_feasibility text NOT NULL DEFAULT 'NOT_ASSESSED',
  risk text NOT NULL,
  confidence numeric(5,4),
  qa_result text NOT NULL,
  requires_human_review boolean NOT NULL,
  blocking_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  run_mode text NOT NULL DEFAULT 'SHADOW_READ_ONLY' CHECK (run_mode = 'SHADOW_READ_ONLY')
);

CREATE TABLE IF NOT EXISTS read_models.operations_discount_workflows (
  canonical_order_id text PRIMARY KEY,
  dropea_order_id text NOT NULL,
  original_amount numeric(14,2),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount <= 5),
  new_amount numeric(14,2),
  offer_created_at timestamptz,
  response_status text NOT NULL DEFAULT 'UNKNOWN',
  accepted_at timestamptz,
  email_prepared boolean NOT NULL DEFAULT false,
  email_sent boolean NOT NULL DEFAULT false CHECK (email_sent = false),
  dropea_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  cod_change_verified boolean NOT NULL DEFAULT false,
  ready_for_retry boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'NOT_OFFERED',
  updated_at timestamptz NOT NULL,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE TABLE IF NOT EXISTS read_models.operations_timeline_records (
  timeline_id text PRIMARY KEY,
  canonical_order_id text NOT NULL,
  canonical_issue_id text,
  event_type text NOT NULL,
  source text NOT NULL,
  occurred_at timestamptz NOT NULL,
  summary_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness text NOT NULL DEFAULT 'UNKNOWN'
);

CREATE TABLE IF NOT EXISTS read_models.operations_connector_health (
  connector text PRIMARY KEY,
  transport_health text NOT NULL,
  data_health text NOT NULL,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  lag_seconds bigint,
  pagination_complete boolean,
  checked_at timestamptz NOT NULL
);

CREATE OR REPLACE VIEW read_models.operations_orders_summary AS
SELECT
  count(*)::integer AS total,
  count(*) FILTER (WHERE risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
  count(*) FILTER (WHERE decision_status = 'HUMAN_REVIEW')::integer AS human_review,
  count(*) FILTER (WHERE freshness = 'STALE')::integer AS stale,
  max(updated_at) AS last_sync_at,
  0::integer AS actions_executed,
  0::integer AS production_writes
FROM read_models.operations_order_records;

CREATE OR REPLACE VIEW read_models.operations_orders_queue AS
SELECT canonical_order_id, dropea_order_id, status, sub_status, canonical_state,
       product_summary, total_amount, currency, carrier, tracking_reference_masked,
       identity_status, decision_status, risk, priority, freshness, latest_message_at,
       updated_at, actions_executed, production_writes, run_mode
FROM read_models.operations_order_records;

CREATE OR REPLACE VIEW read_models.operations_order_detail AS
SELECT o.*, c.has_customer_replied, c.latest_inbound_message_at,
       c.latest_relevant_message_hash, c.detected_intent, c.requested_date,
       c.requested_time_window, c.address_change_detected, c.refusal_detected,
       c.acceptance_detected, c.discount_accepted, c.change_of_intent,
       c.contradiction, c.confidence AS conversation_confidence,
       c.messages_used, c.messages_ignored, c.explanation_masked
FROM read_models.operations_order_records o
LEFT JOIN read_models.operations_conversation_summaries c USING (canonical_order_id);

CREATE OR REPLACE VIEW read_models.operations_incidents_summary AS
SELECT
  count(*) FILTER (WHERE actionable)::integer AS pending,
  count(*) FILTER (WHERE customer_response_status = 'RESPONDED')::integer AS responded,
  count(*) FILTER (WHERE customer_response_status IN ('NO_RESPONSE','UNKNOWN'))::integer AS awaiting_customer,
  count(*) FILTER (WHERE risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
  count(*) FILTER (WHERE qa_result = 'BLOCKED')::integer AS blocked,
  count(*) FILTER (WHERE freshness = 'STALE')::integer AS stale,
  max(updated_at) AS last_sync_at,
  0::integer AS actions_executed,
  0::integer AS production_writes
FROM read_models.operations_incident_records;

CREATE OR REPLACE VIEW read_models.operations_incidents_queue AS
SELECT canonical_issue_id, dropea_issue_id, canonical_order_id, dropea_order_id,
       type, status, is_active, actionable, carrier, tracking_reference_masked,
       allowed_resolution_options, delivery_attempt_number, carrier_retention_deadline,
       customer_response_status, customer_intent, proposed_resolution, decision_id,
       risk, priority, qa_result, blocking_reasons, due_at, discount_status,
       freshness, created_at, updated_at, actions_executed, production_writes, run_mode
FROM read_models.operations_incident_records
WHERE status = 'PENDING' AND is_active = true;

CREATE OR REPLACE VIEW read_models.operations_incident_detail AS
SELECT i.*, c.has_customer_replied, c.latest_inbound_message_at,
       c.latest_relevant_message_hash, c.detected_intent, c.requested_date,
       c.requested_time_window, c.address_change_detected, c.refusal_detected,
       c.acceptance_detected, c.discount_accepted, c.change_of_intent,
       c.contradiction, c.confidence AS conversation_confidence,
       c.messages_used, c.messages_ignored, c.explanation_masked,
       d.payload_masked AS decision_payload_masked, d.policy_version AS decision_policy_version,
       d.reason_codes, d.dropea_validation, d.gls_feasibility,
       d.confidence AS decision_confidence, d.requires_human_review,
       w.original_amount, w.discount_amount, w.new_amount, w.offer_created_at,
       w.response_status AS discount_response_status, w.accepted_at AS discount_accepted_at,
       w.email_prepared, w.email_sent, w.dropea_status AS discount_dropea_status,
       w.cod_change_verified, w.ready_for_retry
FROM read_models.operations_incident_records i
LEFT JOIN read_models.operations_conversation_summaries c USING (canonical_order_id)
LEFT JOIN read_models.operations_decision_cards d ON d.decision_id = i.decision_id
LEFT JOIN read_models.operations_discount_workflows w ON w.canonical_order_id = i.canonical_order_id;

CREATE INDEX IF NOT EXISTS operations_orders_status_idx ON read_models.operations_order_records(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS operations_orders_decision_idx ON read_models.operations_order_records(decision_status, risk, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS operations_orders_freshness_idx ON read_models.operations_order_records(freshness, updated_at DESC);
CREATE INDEX IF NOT EXISTS operations_incidents_queue_idx ON read_models.operations_incident_records(status, is_active, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS operations_incidents_resolution_idx ON read_models.operations_incident_records(proposed_resolution, risk, due_at);
CREATE INDEX IF NOT EXISTS operations_incidents_freshness_idx ON read_models.operations_incident_records(freshness, updated_at DESC);
CREATE INDEX IF NOT EXISTS operations_conversation_latest_idx ON read_models.operations_conversation_summaries(latest_inbound_message_at DESC);
CREATE INDEX IF NOT EXISTS operations_timeline_order_idx ON read_models.operations_timeline_records(canonical_order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS operations_timeline_issue_idx ON read_models.operations_timeline_records(canonical_issue_id, occurred_at DESC);

GRANT USAGE ON SCHEMA read_models TO suleia_operations_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA read_models TO suleia_operations_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA read_models TO suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA read_models GRANT SELECT ON TABLES TO suleia_operations_readonly;
GRANT SELECT, INSERT, UPDATE ON read_models.operations_order_records,
  read_models.operations_incident_records, read_models.operations_conversation_summaries,
  read_models.operations_decision_cards, read_models.operations_discount_workflows,
  read_models.operations_timeline_records, read_models.operations_connector_health
TO suleia_ingestion;
GRANT SELECT ON ALL TABLES IN SCHEMA read_models TO suleia_backup;

COMMIT;
