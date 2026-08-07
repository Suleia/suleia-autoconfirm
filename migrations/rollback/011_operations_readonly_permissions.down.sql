BEGIN;

REVOKE SELECT ON operations.chatby_conversation_events,
  operations.incident_intent_timeline,
  operations.incident_timers,
  operations.incident_simulation_decisions,
  operations.incident_discount_workflow
FROM suleia_mcp_readonly, suleia_operations_readonly;
REVOKE USAGE ON SCHEMA operations FROM suleia_mcp_readonly, suleia_operations_readonly;

COMMIT;
