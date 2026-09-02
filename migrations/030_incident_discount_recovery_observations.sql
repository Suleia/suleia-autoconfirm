BEGIN;

CREATE TABLE IF NOT EXISTS operations.incident_discount_recovery_observations (
  canonical_issue_id text PRIMARY KEY,
  dropea_issue_id text NOT NULL,
  dropea_order_id text NOT NULL,
  incident_type text NOT NULL CHECK (incident_type='REJECTED_GOODS'),
  recovery_status text NOT NULL,
  response_status text NOT NULL CHECK (response_status IN (
    'DISCOUNT_ACCEPTED','DISCOUNT_REJECTED','OTHER_RESPONSE','NO_RESPONSE','NOT_SENT','NOT_VERIFIABLE'
  )),
  initial_template_sent_at timestamptz,
  discount_due_at timestamptz,
  discount_sent_at timestamptz,
  responded_at timestamptz,
  delivery_verified boolean NOT NULL DEFAULT false,
  cross_source_verified boolean NOT NULL DEFAULT false,
  original_amount numeric(14,2),
  discount_amount numeric(14,2) CHECK (discount_amount IS NULL OR (discount_amount>0 AND discount_amount<=5)),
  final_amount numeric(14,2),
  signal_quality text NOT NULL CHECK (signal_quality IN ('VERIFIED','NOT_VERIFIABLE')),
  source_updated_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed=0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes=0),
  run_mode text NOT NULL DEFAULT 'SHADOW_READ_ONLY' CHECK (run_mode='SHADOW_READ_ONLY'),
  CONSTRAINT incident_discount_response_evidence_check CHECK (
    response_status NOT IN ('DISCOUNT_ACCEPTED','DISCOUNT_REJECTED','OTHER_RESPONSE')
    OR (delivery_verified=true AND discount_sent_at IS NOT NULL AND responded_at>discount_sent_at)
  )
);

CREATE INDEX IF NOT EXISTS incident_discount_recovery_status_idx
  ON operations.incident_discount_recovery_observations(response_status,source_updated_at DESC);

CREATE OR REPLACE VIEW read_models.operations_incident_discount_recovery_latest AS
SELECT canonical_issue_id,dropea_issue_id,dropea_order_id,incident_type,recovery_status,
       response_status,initial_template_sent_at,discount_due_at,discount_sent_at,responded_at,
       delivery_verified,cross_source_verified,original_amount,discount_amount,final_amount,
       signal_quality,source_updated_at,ingested_at,actions_executed,production_writes,run_mode
FROM operations.incident_discount_recovery_observations;

REVOKE ALL ON operations.incident_discount_recovery_observations FROM PUBLIC;
REVOKE ALL ON read_models.operations_incident_discount_recovery_latest FROM PUBLIC;
REVOKE ALL ON operations.incident_discount_recovery_observations FROM suleia_mcp_readonly;
REVOKE ALL ON read_models.operations_incident_discount_recovery_latest FROM suleia_mcp_readonly;
GRANT SELECT,INSERT,UPDATE ON operations.incident_discount_recovery_observations TO suleia_ingestion;
GRANT SELECT ON operations.incident_discount_recovery_observations TO suleia_backup;
GRANT SELECT ON read_models.operations_incident_discount_recovery_latest TO suleia_operations_readonly,suleia_backup;

COMMIT;
