BEGIN;

CREATE OR REPLACE VIEW read_models.operations_data_freshness AS
SELECT market, store_id, resource_type, phase,
       sync_completed_at AS source_updated_at,
       freshness, pagination_complete, records_read, errors, updated_at AS measured_at,
       0::integer AS actions_executed, 0::integer AS production_writes,
       sync_completed_at AS source_observed_at,
       source_updated_at AS source_event_at,
       updated_at AS ingested_at,
       sync_completed_at AS last_successful_sync_at,
       pagination_complete AS sync_complete
FROM integration.dropea_sync_checkpoints;

GRANT SELECT ON read_models.operations_data_freshness TO suleia_mcp_readonly, suleia_operations_readonly;

COMMIT;
