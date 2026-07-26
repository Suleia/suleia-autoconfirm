BEGIN;

REVOKE SELECT ON
  mcp.orders_read,
  mcp.order_timeline,
  mcp.data_freshness,
  mcp.active_timers,
  mcp.agent_decisions,
  mcp.orders_requiring_review
FROM suleia_mcp_readonly;

DROP VIEW IF EXISTS mcp.orders_requiring_review;
DROP VIEW IF EXISTS mcp.agent_decisions;
DROP VIEW IF EXISTS mcp.active_timers;
DROP VIEW IF EXISTS mcp.data_freshness;
DROP VIEW IF EXISTS mcp.order_timeline;
DROP VIEW IF EXISTS mcp.orders_read;

GRANT USAGE ON SCHEMA core, events, decisions, configuration
  TO suleia_mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA core, events, decisions, configuration
  TO suleia_mcp_readonly;

COMMIT;
