BEGIN;
-- Presentation only. No operational rows, flags, timers or policies are changed.
CREATE OR REPLACE VIEW read_models.operations_workflow_status AS
WITH workflows AS (
 SELECT DISTINCT type AS workflow FROM read_models.operations_incident_records
 UNION SELECT workflow FROM operations.recipient_absent_native_control
), cases AS (
 SELECT i.type AS workflow,count(*) AS case_count,max(c.updated_at) AS last_activity,
 bool_or(c.mode IN ('SIMULATION','SHADOW_READ_ONLY')) AS has_shadow
 FROM operations.incident_autopilot_cases c
 JOIN read_models.operations_incident_records i USING(canonical_issue_id,canonical_order_id)
 GROUP BY i.type
)
SELECT w.workflow,coalesce(c.case_count,0) AS case_count,c.last_activity,c.has_shadow,
 n.status AS notification_mode,n.automation_live,n.native_send_enabled,n.template_sends_enabled,
 n.canary_issue_id,n.recipient_absent_template_cutover_at,
 n.circuit_breaker_reason AS notification_breaker_reason,n.circuit_breaker_at AS notification_breaker_at,
 n.evidence->>'evidence_id' AS notification_evidence_id,
 (n.evidence->>'approved_v3_verified')::boolean AS approved_v3_verified,
 r.status AS resolution_mode,r.canary_issue_id AS resolution_canary_issue_id,
 r.circuit_breaker_reason AS resolution_breaker_reason,r.circuit_breaker_at AS resolution_breaker_at,
 (SELECT count(*) FROM operations.recipient_absent_native_notifications x WHERE w.workflow='RECIPIENT_ABSENT') AS reservations,
 (SELECT count(*) FROM operations.recipient_absent_native_notifications x WHERE w.workflow='RECIPIENT_ABSENT' AND x.status='VERIFIED') AS notifications,
 (SELECT count(*) FROM operations.recipient_absent_native_timers x WHERE w.workflow='RECIPIENT_ABSENT') AS timers,
 (SELECT count(*) FROM operations.recipient_absent_resolutions x WHERE w.workflow='RECIPIENT_ABSENT' AND x.status='APPLIED') AS resolutions
FROM workflows w LEFT JOIN cases c USING(workflow)
LEFT JOIN operations.recipient_absent_native_control n USING(workflow)
LEFT JOIN operations.recipient_absent_resolution_control r USING(workflow);

CREATE OR REPLACE VIEW read_models.operations_workflow_recent_actions AS
SELECT 'notification:'||claim_id::text AS id,'RECIPIENT_ABSENT'::text AS workflow,canonical_issue_id,
 'SEND_CHATBY_TEMPLATE'::text AS action_type,'Chatby'::text AS provider,
 CASE status WHEN 'VERIFIED' THEN 'VERIFIED' WHEN 'FAILED' THEN 'FAILED' WHEN 'SENT' THEN 'REQUESTED' ELSE 'REQUESTED' END AS execution_status,
 claimed_at AS requested_at,notification_at AS executed_at,verified_at,
 coalesce(verified_at,notification_at,claimed_at) AS occurred_at,'REAL'::text AS evidence_mode,
 NULL::text AS blocking_reason
FROM operations.recipient_absent_native_notifications
UNION ALL
SELECT 'resolution:'||canonical_issue_id,'RECIPIENT_ABSENT',canonical_issue_id,'PROVIDE_SOLUTION','Dropea',
 CASE status WHEN 'APPLIED' THEN 'VERIFIED' WHEN 'UNVERIFIED' THEN 'UNKNOWN' WHEN 'ABORTED' THEN 'BLOCKED' ELSE 'REQUESTED' END,
 created_at,CASE WHEN status='APPLIED' THEN updated_at END,CASE WHEN status='APPLIED' THEN updated_at END,
 updated_at,'REAL',NULL FROM operations.recipient_absent_resolutions
UNION ALL
SELECT 'shadow:'||a.action_id,i.type,a.canonical_issue_id,a.action_type,a.provider,
 CASE WHEN a.status='BLOCKED' THEN 'BLOCKED' ELSE 'PREPARED' END,
 NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,a.created_at,'SHADOW',NULL
FROM operations.incident_action_outbox a
JOIN read_models.operations_incident_records i USING(canonical_issue_id,canonical_order_id);

REVOKE ALL ON read_models.operations_workflow_status,read_models.operations_workflow_recent_actions FROM PUBLIC;
GRANT SELECT ON read_models.operations_workflow_status,read_models.operations_workflow_recent_actions
 TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
COMMIT;
