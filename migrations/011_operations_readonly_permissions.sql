BEGIN;

GRANT USAGE ON SCHEMA operations TO suleia_mcp_readonly, suleia_operations_readonly;
GRANT USAGE ON SCHEMA core TO suleia_mcp_readonly, suleia_operations_readonly;
GRANT SELECT ON core.source_freshness TO suleia_mcp_readonly, suleia_operations_readonly;
GRANT SELECT ON operations.chatby_conversation_events,
  operations.incident_intent_timeline,
  operations.incident_timers,
  operations.incident_simulation_decisions,
  operations.incident_discount_workflow
TO suleia_mcp_readonly, suleia_operations_readonly;

COMMIT;
