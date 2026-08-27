BEGIN;

ALTER TABLE integration.dropea_orders
  ADD COLUMN IF NOT EXISTS order_costs_masked jsonb;

COMMENT ON COLUMN integration.dropea_orders.order_costs_masked IS
  'Read-only Dropea V2 supplier/fulfillment cost components. Null means unavailable; it is never interpreted as zero.';

CREATE OR REPLACE VIEW read_models.operations_order_financial_inputs AS
SELECT canonical_order_id,order_costs_masked AS order_costs
FROM integration.dropea_orders;

REVOKE ALL ON read_models.operations_order_financial_inputs FROM PUBLIC,suleia_mcp_readonly;
GRANT SELECT ON read_models.operations_order_financial_inputs TO suleia_operations_readonly,suleia_backup;

COMMIT;
