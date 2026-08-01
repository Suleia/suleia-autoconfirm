BEGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA read_models REVOKE SELECT ON TABLES FROM suleia_operations_readonly;
REVOKE SELECT ON ALL TABLES IN SCHEMA read_models FROM suleia_mcp_readonly;
DROP VIEW IF EXISTS read_models.operations_incident_detail;
DROP VIEW IF EXISTS read_models.operations_incidents_queue;
DROP VIEW IF EXISTS read_models.operations_incidents_summary;
DROP VIEW IF EXISTS read_models.operations_order_detail;
DROP VIEW IF EXISTS read_models.operations_orders_queue;
DROP VIEW IF EXISTS read_models.operations_orders_summary;
DROP TABLE IF EXISTS read_models.operations_connector_health;
DROP TABLE IF EXISTS read_models.operations_timeline_records;
DROP TABLE IF EXISTS read_models.operations_discount_workflows;
DROP TABLE IF EXISTS read_models.operations_decision_cards;
DROP TABLE IF EXISTS read_models.operations_conversation_summaries;
DROP TABLE IF EXISTS read_models.operations_incident_records;
DROP TABLE IF EXISTS read_models.operations_order_records;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_api_login') THEN
    REVOKE suleia_operations_readonly FROM suleia_api_login;
  END IF;
END
$$;
DROP OWNED BY suleia_operations_readonly;
DROP ROLE IF EXISTS suleia_operations_readonly;
COMMIT;
