BEGIN;

-- Keep the incident-derived context authoritative when an active issue exists.
-- For ordinary pending orders, expose only the masked operational Chatby category.
CREATE OR REPLACE VIEW read_models.operations_order_context AS
SELECT o.canonical_order_id,o.market,o.store_id,o.dropea_order_id,o.external_order_id_hash,
       o.status,o.sub_status,d.lifecycle_status,o.product_display_names,o.product_summary,
       o.total_amount,o.currency,d.payment_method,o.carrier,o.service_type,
       d.created_at_utc,d.updated_at_utc,o.updated_at,d.confirmed_at_utc,d.processing_at_utc,d.delivered_at_utc,
       d.cancelled_at_utc,d.returned_at_utc,
       ai.canonical_issue_id AS active_issue_id,ai.status AS active_issue_status,
       ai.normalized_type AS active_issue_type,ai.initial_carrier_code AS active_issue_carrier_code,
       (SELECT count(*)::integer FROM read_models.operations_incident_records h WHERE h.canonical_order_id=o.canonical_order_id) AS incident_count,
       coalesce(ai.conversation_status,CASE WHEN cs.canonical_order_id IS NOT NULL THEN 'FOUND' END) AS conversation_status,
       coalesce(ai.customer_replied_after_issue,cs.has_customer_replied,false) AS customer_replied_after_issue,
       coalesce(ai.latest_customer_activity_at,cs.latest_inbound_message_at) AS latest_customer_activity_at,
       coalesce(ai.customer_intent,cs.detected_intent) AS latest_customer_intent,
       coalesce(ai.contradiction,cs.contradiction<>'NONE',false) AS contradiction,
       ai.timer_type,ai.timer_started_at,ai.timer_due_at,ai.timer_status,ai.policy_id,ai.policy_version,
       ai.simulated_decision,ai.simulated_action_type,ai.blocking_reasons,
       o.duplicate_status,
       (SELECT count(*)::integer FROM read_models.issue_state_history h
         WHERE h.canonical_order_id=o.canonical_order_id AND coalesce(h.resolution_status,'') LIKE 'RETURN%') AS return_history_count,
       coalesce(ai.risk,o.risk) AS risk,coalesce(ai.human_review,o.protection_review) AS human_review,
       o.identity_status,o.freshness,
       CASE WHEN o.identity_status NOT IN ('EXACT','VERIFIED') THEN 'IDENTITY_UNCERTAIN'
            WHEN o.freshness='STALE' THEN 'STALE' ELSE 'OK' END AS data_quality_status,
       o.source_system,d.source_version,d.observed_at AS source_updated_at,d.observed_at,
       o.actions_executed,o.production_writes,o.run_mode
FROM read_models.operations_order_records o
LEFT JOIN integration.dropea_orders d USING(canonical_order_id)
LEFT JOIN read_models.operations_conversation_summaries cs USING(canonical_order_id)
LEFT JOIN LATERAL (
  SELECT q.* FROM read_models.operations_incident_context q
  WHERE q.canonical_order_id=o.canonical_order_id AND q.status='PENDING' AND q.is_active=true
  ORDER BY q.updated_at DESC LIMIT 1
) ai ON true;

GRANT SELECT ON read_models.operations_order_context
TO suleia_mcp_readonly,suleia_operations_readonly,suleia_backup;

COMMIT;
