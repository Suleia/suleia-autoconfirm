BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA core, events, decisions, configuration
  FROM suleia_mcp_readonly;
REVOKE USAGE ON SCHEMA core, events, decisions, configuration
  FROM suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA core REVOKE SELECT ON TABLES FROM suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA events REVOKE SELECT ON TABLES FROM suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA decisions REVOKE SELECT ON TABLES FROM suleia_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA configuration REVOKE SELECT ON TABLES FROM suleia_mcp_readonly;

CREATE OR REPLACE VIEW mcp.orders_read AS
SELECT
  o.id,
  o.external_order_id,
  o.source_status,
  o.canonical_status,
  o.currency,
  o.total_amount,
  o.created_at_source,
  o.last_source_update_at,
  c.display_name_masked,
  c.phone_masked,
  c.email_masked,
  c.address_masked,
  c.masking_version
FROM core.orders o
LEFT JOIN core.customers_masked c ON c.id = o.customer_id;

CREATE OR REPLACE VIEW mcp.order_timeline AS
SELECT
  e.event_id,
  e.order_id,
  e.event_type,
  e.occurred_at,
  e.received_at,
  e.source,
  e.payload_masked,
  e.trust_level,
  e.freshness_status,
  e.run_mode
FROM events.order_events e;

CREATE OR REPLACE VIEW mcp.data_freshness AS
SELECT
  source,
  last_success_at,
  last_failure_at,
  lag_seconds,
  status,
  checked_at
FROM core.source_freshness;

CREATE OR REPLACE VIEW mcp.active_timers AS
SELECT
  id,
  order_id,
  incident_id,
  workflow,
  status,
  started_at,
  deadline_at,
  policy_version,
  created_at
FROM core.timers
WHERE status = 'ACTIVE';

CREATE OR REPLACE VIEW mcp.agent_decisions AS
SELECT
  decision_id,
  order_id,
  snapshot_version,
  workflow,
  route,
  proposed_action,
  final_confidence,
  reason_summary,
  risk_level,
  qa_status,
  requires_human_review,
  actions_executed,
  run_mode,
  policy_versions,
  created_at
FROM decisions.decision_records;

CREATE OR REPLACE VIEW mcp.orders_requiring_review AS
SELECT
  d.decision_id,
  d.order_id,
  d.workflow,
  d.route,
  d.proposed_action,
  d.final_confidence,
  d.reason_summary,
  d.risk_level,
  d.created_at,
  h.priority,
  h.status AS review_status
FROM decisions.decision_records d
LEFT JOIN decisions.human_review_queue h ON h.decision_id = d.decision_id
WHERE d.requires_human_review
   OR d.route IN ('AI_REVIEW', 'HUMAN_REVIEW', 'BLOCKED');

GRANT USAGE ON SCHEMA mcp TO suleia_mcp_readonly;
GRANT SELECT ON
  mcp.orders_read,
  mcp.order_timeline,
  mcp.data_freshness,
  mcp.active_timers,
  mcp.agent_decisions,
  mcp.orders_requiring_review
TO suleia_mcp_readonly;
GRANT INSERT ON mcp.call_audit TO suleia_mcp_readonly;

COMMIT;
