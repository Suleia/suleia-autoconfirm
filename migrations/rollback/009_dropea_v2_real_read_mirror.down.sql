BEGIN;
DROP VIEW IF EXISTS read_models.integration_dropea_webhook_events;
DROP VIEW IF EXISTS read_models.integration_dropea_sync_checkpoints;
DROP VIEW IF EXISTS read_models.integration_dropea_issues;
DROP VIEW IF EXISTS read_models.integration_dropea_orders;
DROP VIEW IF EXISTS read_models.operations_data_freshness;
ALTER TABLE read_models.operations_incident_records
  DROP COLUMN IF EXISTS interpretation_status, DROP COLUMN IF EXISTS conversation_source,
  DROP COLUMN IF EXISTS payload_hash, DROP COLUMN IF EXISTS automation_allowed,
  DROP COLUMN IF EXISTS human_review, DROP COLUMN IF EXISTS capability_status,
  DROP COLUMN IF EXISTS secondary_type, DROP COLUMN IF EXISTS store_id, DROP COLUMN IF EXISTS market;
ALTER TABLE read_models.operations_order_records
  DROP COLUMN IF EXISTS interpretation_status, DROP COLUMN IF EXISTS conversation_source,
  DROP COLUMN IF EXISTS payload_hash, DROP COLUMN IF EXISTS source_system,
  DROP COLUMN IF EXISTS address_line_2_present, DROP COLUMN IF EXISTS normalized_address_hash,
  DROP COLUMN IF EXISTS product_display_names, DROP COLUMN IF EXISTS store_id, DROP COLUMN IF EXISTS market;
DROP TABLE IF EXISTS integration.dropea_webhook_events;
DROP TABLE IF EXISTS integration.dropea_sync_checkpoints;
DROP TABLE IF EXISTS integration.dropea_issues;
DROP TABLE IF EXISTS integration.dropea_orders;
DROP TABLE IF EXISTS integration.dropea_store_config;
DROP SCHEMA IF EXISTS integration;
COMMIT;
