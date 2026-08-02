BEGIN;

CREATE TABLE IF NOT EXISTS operations.active_customer_product_guard (
  guard_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_identity_hash text NOT NULL,
  canonical_product_key text NOT NULL,
  active_order_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','RELEASED','RECONCILIATION_REQUIRED')),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'ACTIVE' AND released_at IS NULL) OR status <> 'ACTIVE')
);
CREATE UNIQUE INDEX IF NOT EXISTS active_customer_product_guard_one_active_idx
  ON operations.active_customer_product_guard(customer_identity_hash, canonical_product_key)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS operations.order_duplicate_assessments (
  assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_order_id text NOT NULL,
  conflicting_order_id text,
  identity_status text NOT NULL,
  product_match text NOT NULL,
  result text NOT NULL,
  blocking_reason text,
  confidence numeric(5,4),
  reviewed_by_hash text,
  reviewed_at timestamptz,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.chatby_contact_lifecycle (
  lifecycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chatby_contact_id_encrypted bytea,
  chatby_contact_id_hash text NOT NULL,
  phone_last4 text,
  lifecycle_status text NOT NULL,
  linked_active_orders integer NOT NULL DEFAULT 0,
  linked_terminal_orders integer NOT NULL DEFAULT 0,
  linked_unknown_orders integer NOT NULL DEFAULT 0,
  blockers text[] NOT NULL DEFAULT '{}',
  eligible_at timestamptz,
  delete_requested_at timestamptz,
  deleted_at timestamptz,
  deletion_result text,
  idempotency_key text UNIQUE,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.releasit_phone_block_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_order_id text NOT NULL,
  dropea_order_id text,
  phone_encrypted bytea,
  phone_hash text NOT NULL,
  phone_last4 text NOT NULL,
  reason text NOT NULL CHECK (reason = 'RETURN_TO_ORIGIN'),
  source_final_state text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  requested_at timestamptz,
  verified_at timestamptz,
  policy_version text NOT NULL,
  actor_hash text,
  audit_event_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.releasit_configuration_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_hash text NOT NULL,
  blocked_number_count integer NOT NULL CHECK (blocked_number_count >= 0),
  captured_at timestamptz NOT NULL DEFAULT now(),
  operation_id uuid,
  encrypted_backup_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE read_models.operations_order_records
  ADD COLUMN IF NOT EXISTS lifecycle_classification text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS phone_last4 text,
  ADD COLUMN IF NOT EXISTS canonical_product_key text,
  ADD COLUMN IF NOT EXISTS duplicate_status text NOT NULL DEFAULT 'NOT_ASSESSED',
  ADD COLUMN IF NOT EXISTS conflicting_order_id text,
  ADD COLUMN IF NOT EXISTS automatic_confirmation_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chatby_cleanup_status text NOT NULL DEFAULT 'NOT_ASSESSED',
  ADD COLUMN IF NOT EXISTS chatby_cleanup_blockers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS return_block_status text NOT NULL DEFAULT 'NOT_ELIGIBLE',
  ADD COLUMN IF NOT EXISTS return_block_reason text,
  ADD COLUMN IF NOT EXISTS protection_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS protection_last_reconciled_at timestamptz;

DROP VIEW IF EXISTS read_models.operations_order_detail;
DROP VIEW IF EXISTS read_models.operations_orders_queue;

CREATE VIEW read_models.operations_orders_queue AS
SELECT canonical_order_id, dropea_order_id, status, sub_status, canonical_state,
       product_summary, total_amount, currency, carrier, tracking_reference_masked,
       identity_status, decision_status, risk, priority, freshness, latest_message_at,
       updated_at, actions_executed, production_writes, run_mode,
       lifecycle_classification, phone_last4, canonical_product_key, duplicate_status,
       conflicting_order_id, automatic_confirmation_allowed, test_order,
       chatby_cleanup_status, chatby_cleanup_blockers, return_block_status,
       return_block_reason, protection_review, protection_last_reconciled_at
FROM read_models.operations_order_records;

CREATE VIEW read_models.operations_order_detail AS
SELECT o.*, c.has_customer_replied, c.latest_inbound_message_at,
       c.latest_relevant_message_hash, c.detected_intent, c.requested_date,
       c.requested_time_window, c.address_change_detected, c.refusal_detected,
       c.acceptance_detected, c.discount_accepted, c.change_of_intent,
       c.contradiction, c.confidence AS conversation_confidence,
       c.messages_used, c.messages_ignored, c.explanation_masked
FROM read_models.operations_order_records o
LEFT JOIN read_models.operations_conversation_summaries c USING (canonical_order_id);

CREATE OR REPLACE VIEW read_models.operations_protection_summary AS
SELECT
  count(*) FILTER (WHERE duplicate_status = 'DUPLICATE_ACTIVE_ORDER')::integer AS duplicate_orders,
  count(*) FILTER (WHERE test_order)::integer AS test_orders,
  count(*) FILTER (WHERE chatby_cleanup_status = 'DELETE_ELIGIBLE')::integer AS chatby_delete_eligible,
  count(*) FILTER (WHERE chatby_cleanup_status = 'DELETE_FAILED')::integer AS chatby_delete_failed,
  count(*) FILTER (WHERE return_block_status IN ('BLOCK_ELIGIBLE','BLOCK_PENDING','BLOCK_REQUESTED'))::integer AS releasit_pending,
  count(*) FILTER (WHERE return_block_status IN ('BLOCKED_VERIFIED','ALREADY_BLOCKED'))::integer AS releasit_blocked,
  count(*) FILTER (WHERE return_block_status IN ('BLOCK_FAILED','VERIFICATION_FAILED'))::integer AS releasit_errors,
  count(*) FILTER (WHERE protection_review)::integer AS human_review,
  max(protection_last_reconciled_at) AS last_reconciled_at,
  0::integer AS actions_executed
FROM read_models.operations_order_records;

CREATE OR REPLACE VIEW read_models.operations_protection_events AS
SELECT canonical_order_id, dropea_order_id, phone_last4, reason, source_final_state,
       status, attempts, last_error_code, requested_at, verified_at, policy_version,
       created_at, updated_at
FROM operations.releasit_phone_block_events;

CREATE INDEX IF NOT EXISTS order_duplicate_candidate_idx ON operations.order_duplicate_assessments(candidate_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chatby_contact_lifecycle_status_idx ON operations.chatby_contact_lifecycle(lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS releasit_phone_block_status_idx ON operations.releasit_phone_block_events(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS operations_orders_protection_idx ON read_models.operations_order_records(duplicate_status, test_order, chatby_cleanup_status, return_block_status, updated_at DESC);

GRANT SELECT, INSERT, UPDATE ON operations.active_customer_product_guard,
  operations.order_duplicate_assessments, operations.chatby_contact_lifecycle,
  operations.releasit_phone_block_events, operations.releasit_configuration_snapshots
TO suleia_ingestion, suleia_api;
GRANT SELECT ON operations.active_customer_product_guard,
  operations.order_duplicate_assessments, operations.chatby_contact_lifecycle,
  operations.releasit_phone_block_events, operations.releasit_configuration_snapshots
TO suleia_backup;
GRANT SELECT ON read_models.operations_protection_summary, read_models.operations_protection_events
TO suleia_operations_readonly, suleia_mcp_readonly, suleia_backup;

COMMIT;
