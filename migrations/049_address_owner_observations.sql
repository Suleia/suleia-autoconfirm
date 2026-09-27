BEGIN;
CREATE TABLE IF NOT EXISTS operations.address_owner_observations (
 canonical_issue_id text PRIMARY KEY,
 canonical_order_id text NOT NULL,
 dropea_issue_id text NOT NULL,
 dropea_order_id text NOT NULL,
 observation jsonb NOT NULL,
 private_address_ciphertext text,
 source_updated_at timestamptz NOT NULL,
 ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW read_models.operations_address_owner_latest AS SELECT * FROM operations.address_owner_observations;
REVOKE ALL ON operations.address_owner_observations,read_models.operations_address_owner_latest FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON operations.address_owner_observations TO suleia_ingestion;
GRANT SELECT ON operations.address_owner_observations TO suleia_backup;
GRANT SELECT ON read_models.operations_address_owner_latest TO suleia_operations_readonly,suleia_backup;
COMMIT;
