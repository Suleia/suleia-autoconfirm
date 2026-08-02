BEGIN;
DROP VIEW IF EXISTS read_models.operations_protection_events;
DROP VIEW IF EXISTS read_models.operations_protection_summary;
DROP VIEW IF EXISTS read_models.operations_order_detail;
DROP VIEW IF EXISTS read_models.operations_orders_queue;
ALTER TABLE read_models.operations_order_records
  DROP COLUMN IF EXISTS protection_last_reconciled_at,
  DROP COLUMN IF EXISTS protection_review,
  DROP COLUMN IF EXISTS return_block_reason,
  DROP COLUMN IF EXISTS return_block_status,
  DROP COLUMN IF EXISTS chatby_cleanup_blockers,
  DROP COLUMN IF EXISTS chatby_cleanup_status,
  DROP COLUMN IF EXISTS test_order,
  DROP COLUMN IF EXISTS automatic_confirmation_allowed,
  DROP COLUMN IF EXISTS conflicting_order_id,
  DROP COLUMN IF EXISTS duplicate_status,
  DROP COLUMN IF EXISTS canonical_product_key,
  DROP COLUMN IF EXISTS phone_last4,
  DROP COLUMN IF EXISTS lifecycle_classification;
CREATE VIEW read_models.operations_orders_queue AS
SELECT canonical_order_id, dropea_order_id, status, sub_status, canonical_state,
       product_summary, total_amount, currency, carrier, tracking_reference_masked,
       identity_status, decision_status, risk, priority, freshness, latest_message_at,
       updated_at, actions_executed, production_writes, run_mode
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
DROP TABLE IF EXISTS operations.releasit_configuration_snapshots;
DROP TABLE IF EXISTS operations.releasit_phone_block_events;
DROP TABLE IF EXISTS operations.chatby_contact_lifecycle;
DROP TABLE IF EXISTS operations.order_duplicate_assessments;
DROP TABLE IF EXISTS operations.active_customer_product_guard;
COMMIT;
