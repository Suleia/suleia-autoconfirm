BEGIN;
ALTER TABLE operations.chatby_conversation_links ADD COLUMN IF NOT EXISTS history_covered_from timestamptz;
ALTER TABLE operations.chatby_conversation_links ADD COLUMN IF NOT EXISTS notification_observed_at timestamptz;
-- Add a privacy-safe read projection; do not rewrite historical events, policies
-- or timers. A customer response is not an incident response until notification
-- for this exact issue/order has actually been observed in the conversation.
CREATE OR REPLACE VIEW read_models.operations_incident_notification_scope AS
SELECT p.canonical_issue_id,p.canonical_order_id,
  n.occurred_at AS incident_notified_at,n.context_template_slug AS incident_notification_template,
  l.observed_at AS incident_conversation_read_at,
  r.occurred_at AS scoped_customer_activity_at,r.chatby_message_id_hash AS scoped_customer_message_hash,
  r.intent AS scoped_customer_intent,r.message_type AS scoped_customer_message_type,
  coalesce(counts.messages,0)::integer AS scoped_messages_used,
  CASE
    WHEN l.conversation_status IS DISTINCT FROM 'FOUND' OR l.conversation_freshness IS DISTINCT FROM 'FRESH'
      OR l.observed_at IS NULL OR l.observed_at<now()-interval '900 seconds'
      OR l.observed_at>now()+interval '30 seconds'
      OR p.chatby_last_failure_at>=l.observed_at THEN 'NOT_VERIFIABLE'
    WHEN n.occurred_at IS NULL THEN 'NOT_VERIFIABLE'
    WHEN l.notification_observed_at IS NULL OR l.history_covered_from IS NULL
      OR l.history_covered_from>n.occurred_at THEN 'NOT_VERIFIABLE'
    WHEN r.occurred_at IS NOT NULL THEN 'VALID_RESPONSE'
    ELSE 'NO_VALID_RESPONSE'
  END AS scoped_response_status,
  CASE
    WHEN l.conversation_status IS DISTINCT FROM 'FOUND' OR l.conversation_freshness IS DISTINCT FROM 'FRESH'
      OR l.observed_at IS NULL OR l.observed_at<now()-interval '900 seconds'
      OR l.observed_at>now()+interval '30 seconds'
      OR p.chatby_last_failure_at>=l.observed_at THEN 'CHATBY_CASE_READ_NOT_VERIFIABLE'
    WHEN n.occurred_at IS NULL THEN 'INCIDENT_NOTIFICATION_NOT_OBSERVED'
    WHEN l.notification_observed_at IS NULL OR l.history_covered_from IS NULL
      OR l.history_covered_from>n.occurred_at THEN 'NOTIFICATION_TO_READ_HISTORY_NOT_COVERED'
    WHEN r.occurred_at IS NOT NULL THEN 'CUSTOMER_INPUT_AFTER_INCIDENT_NOTIFICATION'
    ELSE 'NO_CUSTOMER_INPUT_AFTER_OBSERVED_NOTIFICATION'
  END AS scoped_response_reason
FROM read_models.operations_incident_panel_context p
LEFT JOIN operations.chatby_conversation_links l USING(canonical_issue_id,canonical_order_id)
LEFT JOIN LATERAL (
  SELECT m.occurred_at,m.context_template_slug
  FROM operations.chatby_private_message_display m
  WHERE m.canonical_issue_id=p.canonical_issue_id AND m.canonical_order_id=p.canonical_order_id
    AND m.direction='OUTBOUND' AND m.message_type='TEMPLATE'
    AND m.occurred_at>=p.created_at AND m.occurred_at<=now()
    AND NOT EXISTS (
      SELECT 1 FROM read_models.operations_incident_panel_context other
      WHERE other.canonical_order_id=p.canonical_order_id AND other.canonical_issue_id<>p.canonical_issue_id
        AND other.status='PENDING' AND other.is_active AND other.created_at<=m.occurred_at
        AND (other.interpreted_type=p.interpreted_type
          OR other.interpreted_type IN ('RECIPIENT_ABSENT','PICKUP_AT_AGENCY') AND p.interpreted_type IN ('RECIPIENT_ABSENT','PICKUP_AT_AGENCY')
          OR other.interpreted_type IN ('ADDRESS_INCORRECT','PENDING_DATA') AND p.interpreted_type IN ('ADDRESS_INCORRECT','PENDING_DATA'))
    )
    AND CASE
      WHEN p.interpreted_type IN ('RECIPIENT_ABSENT','PICKUP_AT_AGENCY') THEN m.context_template_slug IN ('dropea_ausente_v1','dropea_incidencia_ausente_v1','dropea_incidencia_ausente_v2')
      WHEN p.interpreted_type='REFUSED_BY_RECIPIENT' THEN m.context_template_slug='dropea_incidencia_mercancia_v1'
      WHEN p.interpreted_type IN ('ADDRESS_INCORRECT','PENDING_DATA') THEN m.context_template_slug='dropea_incidencia_direccion_v1'
      ELSE false END
  ORDER BY m.occurred_at ASC,m.chatby_message_id_hash LIMIT 1
) n ON true
LEFT JOIN LATERAL (
  SELECT m.occurred_at,m.chatby_message_id_hash,m.intent,m.message_type
  FROM operations.chatby_private_message_display m
  WHERE m.canonical_issue_id=p.canonical_issue_id AND m.canonical_order_id=p.canonical_order_id
    AND m.direction='INBOUND' AND m.occurred_at>n.occurred_at AND m.occurred_at<=l.observed_at
    AND coalesce(m.incident_relevance,'INCIDENT_RELEVANT') NOT IN ('ORDER_LIFECYCLE_ONLY','BEFORE_INCIDENT','BEFORE_NOTIFICATION','NOTIFICATION_NOT_OBSERVED')
    AND coalesce(m.context_template_slug,'') NOT LIKE 'dropea_pedido_%'
  ORDER BY m.occurred_at DESC,m.chatby_message_id_hash DESC LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS messages FROM operations.chatby_private_message_display m
  WHERE m.canonical_issue_id=p.canonical_issue_id AND m.canonical_order_id=p.canonical_order_id
    AND m.direction='INBOUND' AND m.occurred_at>n.occurred_at AND m.occurred_at<=l.observed_at
    AND coalesce(m.incident_relevance,'INCIDENT_RELEVANT') NOT IN ('ORDER_LIFECYCLE_ONLY','BEFORE_INCIDENT','BEFORE_NOTIFICATION','NOTIFICATION_NOT_OBSERVED')
    AND coalesce(m.context_template_slug,'') NOT LIKE 'dropea_pedido_%'
) counts ON true;

-- Preserve the entire original contract, replacing only response-derived fields.
-- This also corrects already-persisted append-only events at query time.
DO $migration$
DECLARE columns_sql text;
BEGIN
  SELECT string_agg(CASE a.attname
    WHEN 'customer_replied_after_issue' THEN '(s.scoped_response_status=''VALID_RESPONSE'') AS customer_replied_after_issue'
    WHEN 'latest_customer_activity_at' THEN 'CASE WHEN s.scoped_response_status=''VALID_RESPONSE'' THEN s.scoped_customer_activity_at ELSE NULL::timestamptz END AS latest_customer_activity_at'
    WHEN 'last_button_intent' THEN 'CASE WHEN s.scoped_response_status=''VALID_RESPONSE'' AND s.scoped_customer_message_type=''BUTTON'' THEN s.scoped_customer_intent ELSE NULL::text END AS last_button_intent'
    WHEN 'customer_intent' THEN 'CASE WHEN s.scoped_response_status=''VALID_RESPONSE'' THEN coalesce(s.scoped_customer_intent,''UNKNOWN'') WHEN s.scoped_response_status=''NO_VALID_RESPONSE'' THEN ''NO_RESPONSE'' ELSE ''UNKNOWN'' END AS customer_intent'
    WHEN 'messages_used' THEN 'CASE WHEN s.scoped_response_status=''VALID_RESPONSE'' THEN s.scoped_messages_used ELSE 0 END AS messages_used'
    WHEN 'response_evidence_status' THEN 'CASE WHEN s.scoped_response_status=''NO_VALID_RESPONSE'' THEN ''NO_RESPONSE'' ELSE s.scoped_response_status END AS response_evidence_status'
    WHEN 'response_evidence_reason' THEN 's.scoped_response_reason AS response_evidence_reason'
    WHEN 'effective_decision_status' THEN 'CASE WHEN b.stale_decision THEN ''REVIEW'' WHEN a.absent_shadow IS NOT NULL THEN a.absent_shadow->>''simulation_status'' ELSE p.effective_decision_status END AS effective_decision_status'
    WHEN 'effective_human_review' THEN 'CASE WHEN b.stale_decision THEN true WHEN a.absent_shadow IS NOT NULL THEN a.absent_shadow->>''simulation_status''=''HUMAN_REVIEW_REQUIRED'' ELSE p.effective_human_review END AS effective_human_review'
    WHEN 'effective_qa_status' THEN 'CASE WHEN b.stale_decision THEN ''REVIEW'' ELSE p.effective_qa_status END AS effective_qa_status'
    WHEN 'currently_blocked' THEN 'CASE WHEN b.stale_decision THEN true ELSE p.currently_blocked END AS currently_blocked'
    WHEN 'decision_record_status' THEN 'CASE WHEN b.stale_decision THEN ''HISTORICAL'' WHEN a.absent_shadow IS NOT NULL THEN ''PERSISTED'' ELSE p.decision_record_status END AS decision_record_status'
    WHEN 'effective_simulated_action_type' THEN 'CASE WHEN b.stale_decision THEN NULL::text WHEN a.absent_shadow IS NOT NULL THEN a.absent_shadow->>''simulation_action'' ELSE p.effective_simulated_action_type END AS effective_simulated_action_type'
    WHEN 'conditional_proposal' THEN 'CASE WHEN b.stale_decision THEN ''HUMAN_REVIEW_REQUIRED'' WHEN a.absent_shadow IS NOT NULL THEN a.absent_shadow->>''conditional_proposal'' ELSE p.conditional_proposal END AS conditional_proposal'
    WHEN 'waiting_customer' THEN 'CASE WHEN b.stale_decision THEN false WHEN a.absent_shadow IS NOT NULL THEN (a.absent_shadow->>''waiting_customer'')::boolean ELSE p.waiting_customer END AS waiting_customer'
    WHEN 'decision_confidence' THEN 'CASE WHEN b.stale_decision THEN NULL WHEN a.absent_shadow IS NOT NULL THEN (a.absent_shadow->>''decision_confidence'')::numeric ELSE p.decision_confidence END AS decision_confidence'
    WHEN 'effective_blocking_reasons' THEN 'CASE WHEN b.stale_decision THEN coalesce(p.effective_blocking_reasons,''{}''::text[]) || ARRAY[CASE WHEN s.scoped_response_status=''NOT_VERIFIABLE'' THEN s.scoped_response_reason ELSE ''DECISION_NOT_BOUND_TO_SCOPED_RESPONSE'' END] WHEN a.absent_shadow IS NOT NULL THEN ARRAY(SELECT jsonb_array_elements_text(a.absent_shadow->''blocking_reasons'')) ELSE p.effective_blocking_reasons END AS effective_blocking_reasons'
    WHEN 'reason_summary' THEN 'CASE WHEN b.stale_decision THEN ''La evidencia actual requiere revisión; la decisión almacenada no se presenta como vigente'' WHEN a.absent_shadow IS NOT NULL THEN a.absent_shadow->>''reason_text'' ELSE p.reason_summary END AS reason_summary'
    ELSE format('p.%I',a.attname) END,',' ORDER BY a.attnum)
  INTO columns_sql FROM pg_attribute a
  WHERE a.attrelid='read_models.operations_incident_panel_context'::regclass AND a.attnum>0 AND NOT a.attisdropped;
  EXECUTE format($view$
    CREATE OR REPLACE VIEW read_models.operations_incident_evidence_context AS
    SELECT %s,s.incident_notified_at,s.incident_notification_template,s.incident_conversation_read_at,
      s.scoped_customer_message_hash,s.scoped_response_status,s.scoped_response_reason,
      s.scoped_customer_intent,s.scoped_customer_activity_at,
      x.latest_relevant_message_hash AS stored_interpretation_response_hash,
      x.latest_inbound_message_at AS stored_interpretation_message_at,x.customer_intent AS stored_interpretation_intent,
      NOT b.stale_decision AS notification_decision_current
    FROM read_models.operations_incident_panel_context p
    JOIN read_models.operations_incident_notification_scope s USING(canonical_issue_id,canonical_order_id)
    LEFT JOIN read_models.operations_incident_interpretations x USING(canonical_issue_id,canonical_order_id)
    LEFT JOIN read_models.recipient_absent_shadow a USING(canonical_issue_id,canonical_order_id)
    CROSS JOIN LATERAL (
      SELECT coalesce(s.scoped_response_status='VALID_RESPONSE'
        AND x.latest_inbound_message_at=s.scoped_customer_activity_at
        AND x.customer_intent=s.scoped_customer_intent
        AND p.decided_at>=s.scoped_customer_activity_at,false) AS bound_response
    ) binding
    CROSS JOIN LATERAL (
      SELECT s.scoped_response_status='NOT_VERIFIABLE'
        OR (s.scoped_response_status='VALID_RESPONSE' AND NOT binding.bound_response)
        OR (s.scoped_response_status='NO_VALID_RESPONSE' AND x.latest_inbound_message_at IS NOT NULL)
        OR (a.absent_shadow IS NOT NULL AND NOT coalesce(binding.bound_response
          AND a.absent_shadow->'input_snapshot'->>'response_hash'=x.latest_relevant_message_hash,false)) AS stale_decision
    ) b
  $view$,columns_sql);
END $migration$;
REVOKE ALL ON read_models.operations_incident_notification_scope,read_models.operations_incident_evidence_context FROM PUBLIC;
GRANT SELECT ON read_models.operations_incident_notification_scope,read_models.operations_incident_evidence_context TO suleia_operations_readonly,suleia_mcp_readonly,suleia_ingestion,suleia_backup;
COMMIT;
