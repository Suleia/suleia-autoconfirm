BEGIN;

DROP VIEW read_models.operations_data_freshness;

CREATE VIEW read_models.operations_data_freshness AS
SELECT market, store_id, resource_type, phase, sync_completed_at AS source_updated_at,
       freshness, pagination_complete, records_read, errors, updated_at AS measured_at,
       0::integer AS actions_executed, 0::integer AS production_writes
FROM integration.dropea_sync_checkpoints;

GRANT SELECT ON read_models.operations_data_freshness TO suleia_mcp_readonly, suleia_operations_readonly;

COMMIT;
