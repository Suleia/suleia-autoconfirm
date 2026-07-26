BEGIN;

DROP INDEX IF EXISTS ai_review_pending_idx;

ALTER TABLE decisions.human_review_queue
  DROP CONSTRAINT IF EXISTS human_review_queue_status_check,
  DROP COLUMN IF EXISTS order_id,
  DROP COLUMN IF EXISTS snapshot_version,
  DROP COLUMN IF EXISTS reason_codes,
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS confidence,
  DROP COLUMN IF EXISTS freshness_status,
  DROP COLUMN IF EXISTS policy_gaps,
  DROP COLUMN IF EXISTS masked_context,
  DROP COLUMN IF EXISTS evidence_event_ids,
  DROP COLUMN IF EXISTS alternatives,
  DROP COLUMN IF EXISTS final_selection,
  DROP COLUMN IF EXISTS actions_executed,
  DROP COLUMN IF EXISTS run_mode;

ALTER TABLE decisions.ai_review_queue
  DROP CONSTRAINT IF EXISTS ai_review_queue_status_check,
  DROP COLUMN IF EXISTS order_id,
  DROP COLUMN IF EXISTS snapshot_version,
  DROP COLUMN IF EXISTS reason_codes,
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS confidence,
  DROP COLUMN IF EXISTS freshness_status,
  DROP COLUMN IF EXISTS policy_gaps,
  DROP COLUMN IF EXISTS masked_context,
  DROP COLUMN IF EXISTS evidence_event_ids,
  DROP COLUMN IF EXISTS alternatives,
  DROP COLUMN IF EXISTS assigned_reviewer,
  DROP COLUMN IF EXISTS review_notes,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS final_selection,
  DROP COLUMN IF EXISTS actions_executed,
  DROP COLUMN IF EXISTS run_mode;

ALTER TABLE core.timers DROP CONSTRAINT IF EXISTS timers_status_check;
ALTER TABLE core.timers
  DROP COLUMN IF EXISTS timer_type,
  DROP COLUMN IF EXISTS paused_at,
  DROP COLUMN IF EXISTS resumed_at,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS expired_at,
  DROP COLUMN IF EXISTS source_event_id,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS run_mode,
  ADD CONSTRAINT timers_status_check
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED', 'COMPLETED'));

DROP TABLE IF EXISTS operations.system_locks;
DROP TABLE IF EXISTS operations.dead_letter_queue;
DROP TABLE IF EXISTS operations.job_runs;
DROP TABLE IF EXISTS configuration.system_settings;
DROP TABLE IF EXISTS configuration.feature_flags;
DROP TABLE IF EXISTS configuration.freshness_thresholds;
DROP TABLE IF EXISTS configuration.policy_assignments;
DROP TABLE IF EXISTS configuration.policies;
DROP TABLE IF EXISTS audit.action_log;
DROP TABLE IF EXISTS audit.masking_log;
DROP TABLE IF EXISTS audit.sync_runs;
DROP TABLE IF EXISTS audit.security_events;
DROP TABLE IF EXISTS audit.data_access_log;
DROP TABLE IF EXISTS mcp.security_events;
DROP TABLE IF EXISTS mcp.tool_executions;
DROP TABLE IF EXISTS mcp.scopes;
DROP TABLE IF EXISTS mcp.clients;
DROP TABLE IF EXISTS decisions.simulation_comparisons;
DROP TABLE IF EXISTS decisions.review_records;
DROP TABLE IF EXISTS decisions.decision_alternatives;
DROP TABLE IF EXISTS decisions.decision_evidence;
DROP TABLE IF EXISTS decisions.decisions;
DROP TABLE IF EXISTS decisions.agent_proposals;
DROP TABLE IF EXISTS decisions.simulation_runs;
DROP TABLE IF EXISTS events.replay_runs;
DROP TABLE IF EXISTS events.event_snapshots;
DROP TABLE IF EXISTS events.event_corrections;
DROP TABLE IF EXISTS events.event_deduplication;
DROP TABLE IF EXISTS core.customer_aliases;
DROP TABLE IF EXISTS core.order_snapshots;
DROP TABLE IF EXISTS core.order_digital_twins;
DROP TABLE IF EXISTS core.order_source_links;
DROP TABLE IF EXISTS raw.ingestion_errors;
DROP TABLE IF EXISTS raw.source_records;
DROP TABLE IF EXISTS raw.ingestion_batches;

COMMIT;
