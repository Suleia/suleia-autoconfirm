BEGIN;
DROP VIEW IF EXISTS read_models.operations_chatby_conversation_coverage;
DROP VIEW IF EXISTS read_models.operations_incident_handbook_detail;
DROP VIEW IF EXISTS read_models.operations_order_detail;
DROP VIEW IF EXISTS read_models.operations_incidents_queue;
DROP VIEW IF EXISTS read_models.operations_orders_queue;
DROP TABLE IF EXISTS operations.chatby_conversation_links;
COMMIT;
