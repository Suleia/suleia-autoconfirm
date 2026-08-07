BEGIN;

DROP VIEW IF EXISTS read_models.integration_carrier_issue_code_registry;
DROP TABLE IF EXISTS integration.carrier_issue_code_registry;

UPDATE integration.dropea_store_config
SET historical_reingestion_allowed=false
WHERE historical_reingestion_allowed=true;

ALTER TABLE integration.dropea_store_config
  DROP CONSTRAINT IF EXISTS dropea_store_config_historical_reingestion_allowed_check;
ALTER TABLE integration.dropea_store_config
  ADD CONSTRAINT dropea_store_config_historical_reingestion_allowed_check
  CHECK (historical_reingestion_allowed = false);

COMMIT;
