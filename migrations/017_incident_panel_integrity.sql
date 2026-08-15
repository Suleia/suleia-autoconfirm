BEGIN;

-- Additive contract for the incident panel. Keep operations_incident_context
-- intact because the order context depends on it and other consumers may still
-- use its legacy column names during a controlled rollout.
CREATE OR REPLACE VIEW read_models.operations_incident_panel_context AS
WITH source_rows AS (
  SELECT DISTINCT ON (market,store_id,resource_type)
    market,store_id,resource_type,source_observed_at,source_event_at,ingested_at,
    last_successful_sync_at,sync_complete,measured_at
  FROM read_models.operations_data_freshness
  ORDER BY market,store_id,resource_type,last_successful_sync_at DESC NULLS LAST,measured_at DESC
), chatby AS (
  SELECT checked_at AS source_observed_at,last_success_at AS last_successful_sync_at,
         last_failure_at,checked_at AS measured_at
  FROM core.source_freshness
  WHERE lower(source)='chatby'
  ORDER BY checked_at DESC LIMIT 1
)
SELECT c.*,
  CASE
    WHEN c.normalized_type IS NOT NULL AND c.normalized_type NOT IN ('UNKNOWN','UNMAPPED') THEN c.normalized_type
    WHEN c.raw_type IS NOT NULL AND c.raw_type NOT IN ('UNKNOWN','UNMAPPED') THEN c.raw_type
    ELSE 'UNKNOWN'
  END AS interpreted_type,
  CASE
    WHEN c.normalized_type IS NOT NULL AND c.normalized_type NOT IN ('UNKNOWN','UNMAPPED') THEN 'GOVERNED_MAPPING'
    WHEN c.raw_type IS NOT NULL AND c.raw_type NOT IN ('UNKNOWN','UNMAPPED') THEN 'DROPEA_RAW_TYPE'
    ELSE 'UNAVAILABLE'
  END AS interpretation_source,
  CASE
    WHEN cb.last_successful_sync_at IS NULL
      OR cb.last_successful_sync_at < now()-interval '300 seconds'
      OR cb.last_failure_at >= cb.last_successful_sync_at
      OR c.conversation_freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN 'NOT_VERIFIABLE'
    WHEN c.customer_replied_after_issue=true AND coalesce(c.messages_used,0)>0 THEN 'VALID_RESPONSE'
    ELSE 'NO_VALID_RESPONSE'
  END AS response_evidence_status,
  CASE WHEN c.conversation_status IN ('FOUND','NONE','MULTIPLE') THEN 1.0000::numeric(5,4) END
    AS evidence_classification_confidence,
  CASE WHEN c.conversation_freshness='FRESH'
             AND cb.last_successful_sync_at >= now()-interval '300 seconds'
             AND (cb.last_failure_at IS NULL OR cb.last_failure_at < cb.last_successful_sync_at)
             AND c.customer_replied_after_issue=true
             AND coalesce(c.messages_used,0)>0 THEN c.interpretation_confidence END
    AS customer_intent_confidence,
  CASE WHEN c.mapping_status IN ('MAPPED','VERIFIED') THEN 1.0000::numeric(5,4) END
    AS mapping_confidence,
  c.timer_status AS stored_timer_status,
  CASE WHEN c.timer_status='ACTIVE' AND c.timer_due_at <= now() THEN 'EXPIRED'
       ELSE c.timer_status END AS effective_timer_status,
  CASE WHEN c.timer_due_at <= now() THEN extract(epoch FROM (now()-c.timer_due_at))::bigint
       ELSE 0::bigint END AS overdue_seconds,
  CASE
    WHEN cb.last_successful_sync_at IS NULL THEN 'UNKNOWN'
    WHEN cb.last_failure_at >= cb.last_successful_sync_at THEN 'UNAVAILABLE'
    WHEN cb.last_successful_sync_at < now()-interval '300 seconds' THEN 'STALE'
    WHEN c.conversation_freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN c.conversation_freshness
    WHEN ds.last_successful_sync_at IS NOT NULL AND now()-ds.last_successful_sync_at > interval '600 seconds' THEN 'STALE'
    WHEN ds.source_event_at IS NOT NULL AND now()-ds.source_event_at > interval '600 seconds' THEN 'STALE'
    WHEN c.freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN c.freshness
    ELSE 'FRESH'
  END AS effective_freshness_status,
  CASE
    WHEN cb.last_successful_sync_at IS NULL THEN 'UNKNOWN'
    WHEN cb.last_failure_at >= cb.last_successful_sync_at THEN 'UNAVAILABLE'
    WHEN cb.last_successful_sync_at < now()-interval '300 seconds' THEN 'STALE'
    ELSE c.conversation_freshness
  END AS effective_conversation_freshness,
  CASE
    WHEN cb.last_successful_sync_at IS NULL THEN 'CHATBY_LAST_SUCCESS_MISSING'
    WHEN cb.last_failure_at >= cb.last_successful_sync_at THEN 'CHATBY_LATEST_SYNC_FAILED'
    WHEN cb.last_successful_sync_at < now()-interval '300 seconds' THEN 'CHATBY_EVIDENCE_STALE'
    WHEN c.conversation_freshness='STALE' THEN 'CHATBY_EVIDENCE_STALE'
    WHEN c.conversation_freshness='UNAVAILABLE' THEN 'CHATBY_UNAVAILABLE'
    WHEN c.conversation_freshness='UNKNOWN' THEN 'CHATBY_FRESHNESS_UNKNOWN'
    WHEN ds.last_successful_sync_at IS NOT NULL AND now()-ds.last_successful_sync_at > interval '600 seconds' THEN 'DROPEA_POLL_STALE'
    WHEN ds.source_event_at IS NOT NULL AND now()-ds.source_event_at > interval '600 seconds' THEN 'DROPEA_SOURCE_EVENT_STALE'
    WHEN c.freshness='STALE' THEN 'DROPEA_ISSUE_STALE'
    WHEN c.freshness='UNAVAILABLE' THEN 'DROPEA_ISSUE_UNAVAILABLE'
    WHEN c.freshness='UNKNOWN' THEN 'DROPEA_ISSUE_FRESHNESS_UNKNOWN'
    ELSE 'WITHIN_THRESHOLD'
  END AS freshness_reason,
  ds.source_observed_at,ds.source_event_at,ds.ingested_at,ds.last_successful_sync_at,
  CASE WHEN ds.last_successful_sync_at IS NOT NULL
       THEN greatest(0,extract(epoch FROM (now()-ds.last_successful_sync_at))::bigint) END AS poll_age_seconds,
  CASE WHEN ds.source_event_at IS NOT NULL
       THEN greatest(0,extract(epoch FROM (now()-ds.source_event_at))::bigint) END AS source_event_age_seconds,
  CASE WHEN ds.ingested_at IS NOT NULL AND ds.source_event_at IS NOT NULL
       THEN extract(epoch FROM (ds.ingested_at-ds.source_event_at))::bigint END AS ingestion_lag_seconds,
  600::integer AS freshness_threshold_seconds,
  cb.source_observed_at AS chatby_source_observed_at,
  cb.last_successful_sync_at AS chatby_last_successful_sync_at,
  cb.last_failure_at AS chatby_last_failure_at,
  CASE WHEN cb.last_successful_sync_at IS NOT NULL
       THEN greatest(0,extract(epoch FROM (now()-cb.last_successful_sync_at))::bigint) END AS chatby_poll_age_seconds,
  tm.timer_id,
  d.simulation_id AS current_decision_id,
  d.created_at AS decided_at,
  CASE WHEN d.simulation_id IS NULL THEN 'NOT_AVAILABLE'
       WHEN d.superseded_at IS NOT NULL THEN 'SUPERSEDED'
       WHEN d.source_event_id IS NOT DISTINCT FROM ir.source_event_id
            AND extract(epoch FROM d.issue_version::timestamptz)=extract(epoch FROM ir.updated_at) THEN 'CURRENT'
       ELSE 'HISTORICAL' END AS decision_record_status,
  'STORED_SIMULATION'::text AS decision_basis,
  'NOT_MATERIALIZED'::text AS current_preview_status,
  NULL::text AS supersedes_decision_id,
  NULL::text AS input_snapshot_hash,
  NULL::text AS policy_snapshot_hash,
  CASE
    WHEN coalesce(NULLIF(c.normalized_type,'UNKNOWN'),NULLIF(c.raw_type,'UNKNOWN'))='ADDRESS_INCORRECT'
      OR upper(coalesce(c.initial_carrier_description_sanitized,'')) LIKE '%DIRECCI%INCORRECT%'
      THEN 'VALIDATE_COMPLETE_ADDRESS'
    WHEN coalesce(NULLIF(c.normalized_type,'UNKNOWN'),NULLIF(c.raw_type,'UNKNOWN'))='RECIPIENT_ABSENT'
      THEN 'VALIDATE_DELIVERY_AVAILABILITY'
    ELSE 'HUMAN_REVIEW_REQUIRED'
  END AS conditional_proposal,
  'NOT_EXECUTED'::text AS external_action_status,
  ARRAY(SELECT DISTINCT reason FROM unnest(ARRAY_REMOVE(ARRAY[
    CASE WHEN cb.last_successful_sync_at IS NULL THEN 'CHATBY_EVIDENCE_NOT_VERIFIABLE' END,
    CASE WHEN cb.last_failure_at >= cb.last_successful_sync_at THEN 'CHATBY_UNAVAILABLE' END,
    CASE WHEN cb.last_successful_sync_at < now()-interval '300 seconds' THEN 'CHATBY_EVIDENCE_STALE' END,
    CASE WHEN c.conversation_freshness='STALE' THEN 'CHATBY_EVIDENCE_STALE' END,
    CASE WHEN c.conversation_freshness='UNAVAILABLE' THEN 'CHATBY_UNAVAILABLE' END,
    CASE WHEN c.conversation_freshness='UNKNOWN' THEN 'CHATBY_EVIDENCE_NOT_VERIFIABLE' END,
    CASE WHEN c.mapping_status NOT IN ('MAPPED','VERIFIED') THEN 'GLS_CODE_UNMAPPED' END,
    CASE WHEN c.policy_id IS NULL THEN 'POLICY_NOT_PERSISTED' END,
    CASE WHEN c.timer_status='ACTIVE' AND c.timer_due_at <= now() THEN 'TIMER_EXPIRED_NOT_RECONCILED' END
  ],NULL) || coalesce(c.blocking_reasons,'{}'::text[])) reason ORDER BY reason) AS effective_blocking_reasons,
  CASE
    WHEN c.mapping_status NOT IN ('MAPPED','VERIFIED') THEN 'Código GLS pendiente de gobernar'
    WHEN cb.last_successful_sync_at IS NULL OR cb.last_successful_sync_at < now()-interval '300 seconds'
      OR cb.last_failure_at >= cb.last_successful_sync_at
      OR c.conversation_freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN 'Evidencia del cliente no verificable'
    WHEN c.customer_replied_after_issue=false THEN 'Sin respuesta válida posterior a la incidencia'
    ELSE coalesce(c.interpretation_summary,'Revisión humana requerida')
  END AS reason_summary,
  greatest(c.updated_at,c.conversation_snapshot_at,c.source_updated_at) AS panel_updated_at
FROM read_models.operations_incident_context c
JOIN read_models.operations_incident_records ir USING(canonical_issue_id)
LEFT JOIN LATERAL (
  SELECT s.* FROM source_rows s
  WHERE s.market=c.market AND s.store_id=c.store_id
    AND lower(s.resource_type) IN ('issue','issues','incident','incidents')
  ORDER BY s.last_successful_sync_at DESC NULLS LAST LIMIT 1
) ds ON true
LEFT JOIN chatby cb ON true
LEFT JOIN LATERAL (
  SELECT q.timer_id FROM operations.incident_timers q
  WHERE q.canonical_issue_id=c.canonical_issue_id
  ORDER BY (q.status='ACTIVE') DESC,q.updated_at DESC LIMIT 1
) tm ON true
LEFT JOIN LATERAL (
  SELECT q.simulation_id,q.created_at,q.superseded_at,q.source_event_id,q.issue_version
  FROM operations.incident_simulation_decisions q
  WHERE q.canonical_issue_id=c.canonical_issue_id
  ORDER BY q.created_at DESC LIMIT 1
) d ON true;

DROP VIEW IF EXISTS read_models.operations_incidents_summary;
CREATE VIEW read_models.operations_incidents_summary AS
SELECT
  count(*)::integer AS pending,
  count(*) FILTER (WHERE response_evidence_status='VALID_RESPONSE')::integer AS responded,
  count(*) FILTER (WHERE response_evidence_status='NO_VALID_RESPONSE')::integer AS awaiting_customer,
  count(*) FILTER (WHERE response_evidence_status='NOT_VERIFIABLE')::integer AS not_verifiable,
  count(*) FILTER (WHERE risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
  count(*) FILTER (WHERE cardinality(effective_blocking_reasons)>0)::integer AS blocked,
  count(*) FILTER (WHERE effective_freshness_status IN ('STALE','UNAVAILABLE','UNKNOWN'))::integer AS stale,
  count(*) FILTER (WHERE effective_timer_status='EXPIRED')::integer AS timers_expired,
  max(panel_updated_at) AS last_sync_at,
  'ACTIVE'::text AS scope,
  $$status = 'PENDING' AND is_active = true$$::text AS predicate,
  0::integer AS actions_executed,
  0::integer AS production_writes
FROM read_models.operations_incident_panel_context
WHERE status='PENDING' AND is_active=true;

GRANT SELECT ON read_models.operations_incident_panel_context,
  read_models.operations_incidents_summary
TO suleia_mcp_readonly,suleia_operations_readonly;
GRANT SELECT ON read_models.operations_incident_panel_context,
  read_models.operations_incidents_summary TO suleia_backup;

COMMIT;
