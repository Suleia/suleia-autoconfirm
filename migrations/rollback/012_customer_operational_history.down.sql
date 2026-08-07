BEGIN;
DROP VIEW IF EXISTS read_models.customer_operational_history;
ALTER TABLE read_models.operations_order_records DROP COLUMN IF EXISTS customer_identity_hash;
ALTER TABLE integration.dropea_orders DROP COLUMN IF EXISTS customer_identity_hash;
COMMIT;

