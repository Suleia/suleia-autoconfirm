BEGIN;
CREATE TABLE IF NOT EXISTS operations.incident_resolution_observations (
 canonical_issue_id text PRIMARY KEY,
 canonical_order_id text NOT NULL,
 dropea_issue_id text NOT NULL,
 dropea_order_id text NOT NULL,
 observation jsonb NOT NULL,
 source_updated_at timestamptz NOT NULL,
 ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW read_models.operations_incident_resolution_latest AS
 SELECT * FROM operations.incident_resolution_observations;
CREATE OR REPLACE VIEW read_models.customer_replied_unresolved_incidents AS
 SELECT r.* FROM operations.incident_resolution_observations r
 JOIN read_models.operations_incident_records i USING(canonical_issue_id,canonical_order_id)
 WHERE i.is_active=true AND i.status='PENDING'
 AND r.observation->>'customer_replied_but_unresolved'='true';
REVOKE ALL ON operations.incident_resolution_observations,read_models.operations_incident_resolution_latest,read_models.customer_replied_unresolved_incidents FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON operations.incident_resolution_observations TO suleia_ingestion;
GRANT SELECT ON operations.incident_resolution_observations TO suleia_backup;
GRANT SELECT ON read_models.operations_incident_resolution_latest,read_models.customer_replied_unresolved_incidents TO suleia_operations_readonly,suleia_backup;
COMMIT;
