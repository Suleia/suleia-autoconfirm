BEGIN;

-- Ciphertext remains outside generic read models and MCP access. Only the
-- authenticated Operations API role may read this dedicated projection.
CREATE OR REPLACE VIEW read_models.operations_private_order_display AS
SELECT canonical_order_id,external_order_id_ciphertext,shipping_address_ciphertext
FROM integration.dropea_orders;

REVOKE ALL ON read_models.operations_private_order_display FROM PUBLIC;
REVOKE ALL ON read_models.operations_private_order_display FROM suleia_mcp_readonly,suleia_backup;
GRANT SELECT ON read_models.operations_private_order_display TO suleia_operations_readonly;

COMMIT;
