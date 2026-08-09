\set ON_ERROR_STOP on

-- Phase 0: reproducible, aggregate-only diagnosis for the Operations Center.
-- This script is read-only and deliberately returns no customer identifiers,
-- messages, addresses, phones, emails, credentials or external payloads.
BEGIN TRANSACTION READ ONLY;

WITH counters AS (
  SELECT actions_executed, production_writes FROM read_models.operations_order_records
  UNION ALL SELECT actions_executed, production_writes FROM read_models.operations_incident_records
  UNION ALL SELECT actions_executed, production_writes FROM operations.incident_timers
  UNION ALL SELECT actions_executed, production_writes FROM operations.incident_simulation_decisions
)
SELECT 'safety' AS section,
       coalesce(sum(actions_executed), 0) AS actions_executed,
       coalesce(sum(production_writes), 0) AS production_writes
FROM counters;

SELECT 'orders' AS section,
       count(*) AS orders_total,
       count(*) FILTER (WHERE lifecycle_status = 'SHIPPING') AS current_shipping,
       count(*) FILTER (WHERE lifecycle_status IN ('DELIVERED', 'FINISHED')) AS current_delivered,
       count(*) FILTER (WHERE lifecycle_status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'INCIDENCE')) AS current_open,
       count(*) FILTER (WHERE confirmed_at_utc IS NOT NULL) AS confirmed_milestone_present,
       count(*) FILTER (WHERE delivered_at_utc IS NOT NULL) AS delivered_milestone_present,
       count(*) FILTER (WHERE returned_at_utc IS NOT NULL) AS returned_milestone_present,
       count(*) FILTER (WHERE total_amount IS NOT NULL) AS commercial_amount_present
FROM read_models.operations_order_context;

SELECT 'order_history' AS section,
       count(*) AS history_rows,
       count(DISTINCT canonical_order_id) AS distinct_orders,
       count(DISTINCT canonical_order_id) FILTER (WHERE lifecycle_status IN ('SHIPPED', 'SHIPPING')) AS shipped_ever
FROM read_models.order_state_history;

SELECT 'incidents' AS section,
       count(*) AS records_total,
       count(*) FILTER (WHERE status = 'PENDING' AND is_active) AS active_pending,
       count(*) FILTER (WHERE actionable) AS actionable,
       count(*) FILTER (WHERE mapping_status = 'UNMAPPED') AS unmapped,
       count(*) FILTER (WHERE type = 'UNKNOWN') AS unknown_type
FROM read_models.operations_incident_records;

SELECT 'incident_conversation' AS section,
       count(*) FILTER (WHERE conversation_status = 'FOUND') AS conversation_found,
       count(*) FILTER (WHERE conversation_freshness = 'STALE') AS conversation_stale,
       count(*) FILTER (WHERE customer_replied_after_issue) AS valid_reply_after_issue
FROM read_models.operations_incident_context;

SELECT 'incident_summary' AS section,
       pending,
       awaiting_customer,
       blocked,
       stale
FROM read_models.operations_incidents_summary;

SELECT 'timers' AS section,
       count(*) AS timers_total,
       count(*) FILTER (WHERE status = 'ACTIVE') AS active,
       count(*) FILTER (WHERE status = 'ACTIVE' AND due_at <= now()) AS active_past_due,
       count(*) FILTER (WHERE status = 'EXPIRED') AS expired
FROM operations.incident_timers;

SELECT 'decisions' AS section,
       count(*) AS decisions_total,
       count(*) FILTER (WHERE simulated_decision = 'BLOCKED') AS blocked,
       count(*) FILTER (WHERE human_review) AS human_review,
       count(*) - count(DISTINCT (canonical_issue_id, issue_version, source_event_id, policy_version)) AS exact_duplicate_key_rows
FROM operations.incident_simulation_decisions;

SELECT 'chatby' AS section,
       (SELECT count(*) FROM operations.chatby_conversation_links) AS links,
       (SELECT count(*) FROM operations.chatby_conversation_events) AS events,
       (SELECT count(*) FROM operations.incident_intent_timeline) AS intent_events;

SELECT 'carrier_mapping' AS section,
       carrier,
       code,
       mapping_status,
       normalized_type,
       occurrences
FROM integration.carrier_issue_code_registry
WHERE carrier = 'GLS'
ORDER BY occurrences DESC, code;

SELECT 'model_coverage' AS section, table_schema, table_name, row_estimate
FROM (
  SELECT 'core'::text AS table_schema, 'orders'::text AS table_name, count(*)::bigint AS row_estimate FROM core.orders
  UNION ALL SELECT 'core', 'incidents', count(*) FROM core.incidents
  UNION ALL SELECT 'core', 'conversations', count(*) FROM core.conversations
  UNION ALL SELECT 'core', 'messages', count(*) FROM core.messages
  UNION ALL SELECT 'core', 'timers', count(*) FROM core.timers
  UNION ALL SELECT 'integration', 'dropea_orders', count(*) FROM integration.dropea_orders
  UNION ALL SELECT 'integration', 'dropea_issues', count(*) FROM integration.dropea_issues
  UNION ALL SELECT 'operations', 'chatby_conversation_links', count(*) FROM operations.chatby_conversation_links
  UNION ALL SELECT 'operations', 'chatby_conversation_events', count(*) FROM operations.chatby_conversation_events
  UNION ALL SELECT 'operations', 'incident_simulation_decisions', count(*) FROM operations.incident_simulation_decisions
  UNION ALL SELECT 'operations', 'incident_timers', count(*) FROM operations.incident_timers
  UNION ALL SELECT 'decisions', 'decision_records', count(*) FROM decisions.decision_records
  UNION ALL SELECT 'configuration', 'policies', count(*) FROM configuration.policies
  UNION ALL SELECT 'configuration', 'policy_versions', count(*) FROM configuration.policy_versions
  UNION ALL SELECT 'economics', 'observations', count(*) FROM economics.observations
) inventory
ORDER BY table_schema, table_name;

SELECT 'economics_columns' AS section,
       column_name,
       data_type,
       is_nullable
FROM information_schema.columns
WHERE table_schema = 'economics'
  AND table_name = 'observations'
ORDER BY ordinal_position;

ROLLBACK;
