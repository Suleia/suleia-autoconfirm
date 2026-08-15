BEGIN;

DROP VIEW IF EXISTS read_models.operations_incidents_summary;
DROP VIEW IF EXISTS read_models.operations_incident_panel_context;
DROP INDEX IF EXISTS operations.incident_timers_issue_current_idx;

CREATE VIEW read_models.operations_incidents_summary AS
SELECT
  count(*) FILTER (WHERE actionable)::integer AS pending,
  count(*) FILTER (WHERE customer_response_status='RESPONDED')::integer AS responded,
  count(*) FILTER (WHERE customer_response_status IN ('NO_RESPONSE','UNKNOWN'))::integer AS awaiting_customer,
  count(*) FILTER (WHERE risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
  count(*) FILTER (WHERE qa_result='BLOCKED')::integer AS blocked,
  count(*) FILTER (WHERE freshness='STALE')::integer AS stale,
  max(updated_at) AS last_sync_at,
  0::integer AS actions_executed,
  0::integer AS production_writes
FROM read_models.operations_incident_records;

GRANT SELECT ON read_models.operations_incidents_summary
TO suleia_mcp_readonly,suleia_operations_readonly;
GRANT SELECT ON read_models.operations_incidents_summary TO suleia_backup;

COMMIT;
