BEGIN;
ALTER TABLE operations.incident_discount_recovery_observations ADD COLUMN IF NOT EXISTS rejected jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE VIEW read_models.operations_incident_discount_recovery_latest AS
SELECT canonical_issue_id,dropea_issue_id,dropea_order_id,incident_type,recovery_status,
       response_status,initial_template_sent_at,discount_due_at,discount_sent_at,responded_at,
       delivery_verified,cross_source_verified,original_amount,discount_amount,final_amount,
       signal_quality,source_updated_at,ingested_at,actions_executed,production_writes,run_mode,rejected
FROM operations.incident_discount_recovery_observations;
-- Preserve existing view contracts. Expose observed provider actions as REAL,
-- irrespective of the read-only mode of the ingestion process.
CREATE OR REPLACE VIEW read_models.operations_rejected_actions AS
SELECT DISTINCT ON (o.dropea_order_id,o.discount_sent_at)
 'render-offer:'||o.dropea_order_id||':'||o.discount_sent_at::text AS id,
 'RECIPIENT_REJECTED'::text AS workflow,o.canonical_issue_id,
 'OFFER_RECOVERY_DISCOUNT'::text AS action_type,'Chatby / Render'::text AS provider,
 'VERIFIED'::text AS execution_status,o.discount_sent_at AS requested_at,o.discount_sent_at AS executed_at,
 o.discount_sent_at AS verified_at,o.discount_sent_at AS occurred_at,'REAL'::text AS evidence_mode,NULL::text AS blocking_reason
FROM operations.incident_discount_recovery_observations o
JOIN read_models.operations_incident_records i USING(canonical_issue_id)
WHERE o.delivery_verified AND o.discount_sent_at>=i.created_at
ORDER BY o.dropea_order_id,o.discount_sent_at,i.created_at;
CREATE OR REPLACE VIEW read_models.operations_rejected_returns AS
SELECT 'render-return:'||o.canonical_issue_id AS id,'RECIPIENT_REJECTED'::text AS workflow,o.canonical_issue_id,
 'REQUEST_RETURN'::text AS action_type,'Dropea / Render'::text AS provider,
 CASE WHEN o.rejected->>'return_verified'='true' THEN 'VERIFIED' ELSE 'UNKNOWN' END AS execution_status,
 (o.rejected->>'return_requested_at')::timestamptz AS requested_at,
 (o.rejected->>'return_completed_at')::timestamptz AS executed_at,
 CASE WHEN o.rejected->>'return_verified'='true' THEN (o.rejected->>'return_completed_at')::timestamptz END AS verified_at,
 coalesce((o.rejected->>'return_completed_at')::timestamptz,(o.rejected->>'return_requested_at')::timestamptz) AS occurred_at,
 'REAL'::text AS evidence_mode,NULL::text AS blocking_reason
FROM operations.incident_discount_recovery_observations o WHERE o.rejected->>'return_requested_at' IS NOT NULL;
REVOKE ALL ON read_models.operations_rejected_actions,read_models.operations_rejected_returns FROM PUBLIC;
GRANT SELECT ON read_models.operations_rejected_actions,read_models.operations_rejected_returns TO suleia_operations_readonly,suleia_backup;
COMMIT;
