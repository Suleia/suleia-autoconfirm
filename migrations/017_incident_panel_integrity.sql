BEGIN;

-- Additive contract for the incident panel. Keep operations_incident_context
-- intact because the order context depends on it and other consumers may still
-- use its legacy column names during a controlled rollout.
DROP VIEW IF EXISTS read_models.operations_incidents_summary;
DROP VIEW IF EXISTS read_models.operations_incident_panel_context;
CREATE VIEW read_models.operations_incident_panel_context AS
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
    WHEN upper(coalesce(c.initial_carrier_description_sanitized,'')) LIKE '%DIRECCI%INCORRECT%'
      THEN 'ADDRESS_INCORRECT'
    ELSE 'UNKNOWN'
  END AS interpreted_type,
  CASE
    WHEN c.normalized_type IS NOT NULL AND c.normalized_type NOT IN ('UNKNOWN','UNMAPPED') THEN 'GOVERNED_MAPPING'
    WHEN c.raw_type IS NOT NULL AND c.raw_type NOT IN ('UNKNOWN','UNMAPPED') THEN 'DROPEA_RAW_TYPE'
    WHEN upper(coalesce(c.initial_carrier_description_sanitized,'')) LIKE '%DIRECCI%INCORRECT%'
      THEN 'SANITIZED_DESCRIPTION_TEXT'
    ELSE 'UNAVAILABLE'
  END AS interpretation_source,
  CASE
    WHEN c.normalized_type IS NOT NULL AND c.normalized_type NOT IN ('UNKNOWN','UNMAPPED')
      THEN 'Tipologia gobernada disponible'
    WHEN c.raw_type IS NOT NULL AND c.raw_type NOT IN ('UNKNOWN','UNMAPPED')
      THEN 'Tipologia original de Dropea disponible; no equivale a mapping GLS'
    WHEN upper(coalesce(c.initial_carrier_description_sanitized,'')) LIKE '%DIRECCI%INCORRECT%'
      THEN 'Texto observado compatible con un problema de direccion; mapping GLS no inferido'
    ELSE 'Tipologia no verificable con los datos disponibles'
  END AS interpretation_basis,
  CASE
    WHEN cb.last_successful_sync_at IS NULL
      OR cb.last_successful_sync_at < now()-interval '300 seconds'
      OR cb.last_failure_at >= cb.last_successful_sync_at
      OR c.conversation_freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN 'NOT_VERIFIABLE'
    WHEN c.customer_replied_after_issue=true AND coalesce(c.messages_used,0)>0 THEN 'VALID_RESPONSE'
    ELSE 'NO_VALID_RESPONSE'
  END AS response_evidence_status,
  CASE
    WHEN cb.last_successful_sync_at IS NULL THEN 'CHATBY_LAST_SUCCESS_MISSING'
    WHEN cb.last_failure_at >= cb.last_successful_sync_at THEN 'CHATBY_LATEST_SYNC_FAILED'
    WHEN cb.last_successful_sync_at < now()-interval '300 seconds' THEN 'CHATBY_EVIDENCE_STALE'
    WHEN c.conversation_freshness='STALE' THEN 'CHATBY_EVIDENCE_STALE'
    WHEN c.conversation_freshness='UNAVAILABLE' THEN 'CHATBY_UNAVAILABLE'
    WHEN c.conversation_freshness='UNKNOWN' THEN 'CHATBY_FRESHNESS_UNKNOWN'
    WHEN c.customer_replied_after_issue=true AND coalesce(c.messages_used,0)>0 THEN 'VALID_INBOUND_AFTER_ISSUE'
    ELSE 'NO_VALID_INBOUND_AFTER_ISSUE'
  END AS response_evidence_reason,
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
  CASE WHEN c.timer_type IN ('CUSTOMER_INITIAL_RESPONSE_48H','CUSTOMER_DISCOUNT_RESPONSE_48H')
             AND c.timer_status='ACTIVE' AND c.timer_due_at>now()
             AND c.conversation_freshness='FRESH'
             AND cb.last_successful_sync_at>=now()-interval '300 seconds'
             AND (cb.last_failure_at IS NULL OR cb.last_failure_at<cb.last_successful_sync_at)
             AND NOT (c.customer_replied_after_issue=true AND coalesce(c.messages_used,0)>0)
       THEN true ELSE false END AS waiting_customer,
  CASE
    WHEN cb.last_successful_sync_at IS NULL THEN 'UNKNOWN'
    WHEN cb.last_failure_at >= cb.last_successful_sync_at THEN 'UNAVAILABLE'
    WHEN cb.last_successful_sync_at < now()-interval '300 seconds' THEN 'STALE'
    WHEN c.conversation_freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN c.conversation_freshness
    WHEN ds.last_successful_sync_at IS NULL THEN 'UNKNOWN'
    WHEN ds.sync_complete=false THEN 'UNAVAILABLE'
    WHEN now()-ds.last_successful_sync_at > interval '600 seconds' THEN 'STALE'
    WHEN ds.source_event_at IS NULL THEN 'UNKNOWN'
    WHEN now()-ds.source_event_at > interval '600 seconds' THEN 'STALE'
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
    WHEN ds.last_successful_sync_at IS NULL THEN 'UNKNOWN'
    WHEN ds.sync_complete=false THEN 'UNAVAILABLE'
    WHEN now()-ds.last_successful_sync_at > interval '600 seconds' THEN 'STALE'
    WHEN ds.source_event_at IS NULL THEN 'UNKNOWN'
    WHEN now()-ds.source_event_at > interval '600 seconds' THEN 'STALE'
    WHEN c.freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN c.freshness
    ELSE 'FRESH'
  END AS dropea_freshness_status,
  CASE
    WHEN ds.last_successful_sync_at IS NULL THEN 'DROPEA_LAST_SUCCESS_MISSING'
    WHEN ds.sync_complete=false THEN 'DROPEA_SYNC_INCOMPLETE'
    WHEN now()-ds.last_successful_sync_at > interval '600 seconds' THEN 'DROPEA_POLL_STALE'
    WHEN ds.source_event_at IS NULL THEN 'DROPEA_SOURCE_EVENT_MISSING'
    WHEN now()-ds.source_event_at > interval '600 seconds' THEN 'DROPEA_SOURCE_EVENT_STALE'
    WHEN c.freshness='STALE' THEN 'DROPEA_ISSUE_STALE'
    WHEN c.freshness='UNAVAILABLE' THEN 'DROPEA_ISSUE_UNAVAILABLE'
    WHEN c.freshness='UNKNOWN' THEN 'DROPEA_ISSUE_FRESHNESS_UNKNOWN'
    ELSE 'WITHIN_THRESHOLD'
  END AS dropea_freshness_reason,
  CASE
    WHEN cb.last_successful_sync_at IS NULL THEN 'CHATBY_LAST_SUCCESS_MISSING'
    WHEN cb.last_failure_at >= cb.last_successful_sync_at THEN 'CHATBY_LATEST_SYNC_FAILED'
    WHEN cb.last_successful_sync_at < now()-interval '300 seconds' THEN 'CHATBY_EVIDENCE_STALE'
    WHEN c.conversation_freshness='STALE' THEN 'CHATBY_EVIDENCE_STALE'
    WHEN c.conversation_freshness='UNAVAILABLE' THEN 'CHATBY_UNAVAILABLE'
    WHEN c.conversation_freshness='UNKNOWN' THEN 'CHATBY_FRESHNESS_UNKNOWN'
    WHEN ds.last_successful_sync_at IS NULL THEN 'DROPEA_LAST_SUCCESS_MISSING'
    WHEN ds.sync_complete=false THEN 'DROPEA_SYNC_INCOMPLETE'
    WHEN now()-ds.last_successful_sync_at > interval '600 seconds' THEN 'DROPEA_POLL_STALE'
    WHEN ds.source_event_at IS NULL THEN 'DROPEA_SOURCE_EVENT_MISSING'
    WHEN now()-ds.source_event_at > interval '600 seconds' THEN 'DROPEA_SOURCE_EVENT_STALE'
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
  tm.timer_id,tm.policy_version AS timer_policy_version,
  d.simulation_id AS current_decision_id,
  d.created_at AS decided_at,
  dm.record_status AS decision_record_status,
  'STORED_SIMULATION'::text AS decision_basis,
  'NOT_MATERIALIZED'::text AS current_preview_status,
  NULL::text AS supersedes_decision_id,
  NULL::text AS input_snapshot_hash,
  NULL::text AS policy_snapshot_hash,
  'NOT_PERSISTED'::text AS snapshot_status,
  c.simulated_decision AS stored_decision_status,
  CASE WHEN dm.record_status='CURRENT' THEN d.simulated_decision ELSE 'REVIEW' END AS effective_decision_status,
  CASE WHEN dm.record_status='CURRENT' AND d.simulated_decision='BLOCKED' THEN true ELSE false END AS currently_blocked,
  CASE WHEN dm.record_status='CURRENT' THEN d.risk END AS effective_risk,
  CASE WHEN dm.record_status='CURRENT' THEN d.qa_status ELSE 'REVIEW' END AS effective_qa_status,
  CASE WHEN dm.record_status='CURRENT' THEN d.human_review ELSE true END AS effective_human_review,
  d.confidence AS decision_confidence,
  CASE
    WHEN dm.record_status='CURRENT' AND jsonb_typeof(d.simulated_action)='string'
      THEN trim(both '"' from d.simulated_action::text)
    WHEN dm.record_status='CURRENT' AND jsonb_typeof(d.simulated_action)='object'
      THEN coalesce(d.simulated_action->>'action_type',d.simulated_action->>'type')
    ELSE NULL
  END AS effective_simulated_action_type,
  CASE
    WHEN dm.record_status='CURRENT' THEN 'La decision almacenada corresponde a la version actual de la incidencia'
    WHEN dm.record_status='SUPERSEDED' THEN 'La decision almacenada fue sustituida; se requiere una nueva simulacion'
    WHEN dm.record_status='HISTORICAL' THEN 'La decision almacenada pertenece a una version anterior; no se presenta como vigente'
    ELSE 'No existe una decision almacenada verificable para la version actual'
  END AS decision_status_reason,
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
    CASE WHEN coalesce(c.mapping_status,'UNMAPPED') NOT IN ('MAPPED','VERIFIED') THEN 'GLS_CODE_UNMAPPED' END,
    CASE WHEN c.policy_id IS NULL THEN 'POLICY_NOT_PERSISTED' END,
    CASE WHEN coalesce(c.capability_status,'UNKNOWN') IN ('NOT_DECLARED','UNKNOWN')
           OR coalesce(c.delivery_attempt_number,'UNKNOWN') IN ('UNKNOWN','UNAVAILABLE') THEN 'LOGISTICS_STATUS_UNKNOWN' END,
    CASE WHEN c.timer_status='ACTIVE' AND c.timer_due_at <= now() THEN 'TIMER_EXPIRED_NOT_RECONCILED' END,
    CASE WHEN dm.record_status<>'CURRENT' THEN 'INSUFFICIENT_EVIDENCE' END
  ],NULL) || ARRAY(SELECT legacy_reason FROM unnest(coalesce(c.blocking_reasons,'{}'::text[])) legacy_reason
                    WHERE legacy_reason<>'UNKNOWN_ISSUE_TYPE')) reason ORDER BY reason) AS effective_blocking_reasons,
  CASE
    WHEN coalesce(c.mapping_status,'UNMAPPED') NOT IN ('MAPPED','VERIFIED') THEN 'Código GLS pendiente de gobernar'
    WHEN cb.last_successful_sync_at IS NULL OR cb.last_successful_sync_at < now()-interval '300 seconds'
      OR cb.last_failure_at >= cb.last_successful_sync_at
      OR c.conversation_freshness IN ('STALE','UNAVAILABLE','UNKNOWN') THEN 'Evidencia del cliente no verificable'
    WHEN c.customer_replied_after_issue=false THEN 'Sin respuesta válida posterior a la incidencia'
    ELSE coalesce(c.interpretation_summary,'Revisión humana requerida')
  END AS reason_summary,
  greatest(c.updated_at,c.conversation_snapshot_at,c.source_updated_at,
           ds.last_successful_sync_at,cb.last_successful_sync_at) AS panel_updated_at
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
  SELECT q.timer_id,q.policy_version FROM operations.incident_timers q
  WHERE q.canonical_issue_id=c.canonical_issue_id
  ORDER BY (q.status='ACTIVE') DESC,q.updated_at DESC LIMIT 1
) tm ON true
LEFT JOIN LATERAL (
  SELECT q.simulation_id,q.created_at,q.superseded_at,q.source_event_id,q.issue_version,
         q.simulated_decision,q.simulated_action,q.risk,q.confidence,q.qa_status,q.human_review
  FROM operations.incident_simulation_decisions q
  WHERE q.canonical_issue_id=c.canonical_issue_id
  ORDER BY q.created_at DESC LIMIT 1
) d ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN d.simulation_id IS NULL THEN 'NOT_AVAILABLE'
              WHEN d.superseded_at IS NOT NULL THEN 'SUPERSEDED'
              WHEN d.source_event_id IS NOT DISTINCT FROM ir.source_event_id
                   AND d.issue_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                   AND extract(epoch FROM d.issue_version::timestamptz)=extract(epoch FROM ir.updated_at)
                THEN 'CURRENT'
              ELSE 'HISTORICAL' END AS record_status
) dm ON true;

CREATE INDEX IF NOT EXISTS incident_timers_issue_current_idx
  ON operations.incident_timers(canonical_issue_id,status,updated_at DESC);

CREATE VIEW read_models.operations_incidents_summary AS
SELECT
  count(*)::integer AS pending,
  count(*) FILTER (WHERE response_evidence_status='VALID_RESPONSE')::integer AS responded,
  count(*) FILTER (WHERE waiting_customer)::integer AS awaiting_customer,
  count(*) FILTER (WHERE response_evidence_status='NOT_VERIFIABLE')::integer AS not_verifiable,
  count(*) FILTER (WHERE effective_risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
  count(*) FILTER (WHERE currently_blocked AND cardinality(effective_blocking_reasons)>0)::integer AS blocked,
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
