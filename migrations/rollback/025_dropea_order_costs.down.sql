BEGIN;
DROP VIEW IF EXISTS read_models.operations_order_financial_inputs;
ALTER TABLE integration.dropea_orders DROP COLUMN IF EXISTS order_costs_masked;
COMMIT;
