BEGIN;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'integration.dropea_store_config'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%historical_reingestion_allowed%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE integration.dropea_store_config DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS integration.carrier_issue_code_registry (
  carrier text NOT NULL,
  market text NOT NULL,
  code text NOT NULL,
  normalized_type text NOT NULL DEFAULT 'UNKNOWN',
  description_example_sanitized text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrences bigint NOT NULL DEFAULT 1 CHECK (occurrences >= 0),
  mapping_status text NOT NULL DEFAULT 'UNMAPPED',
  policy_id text,
  human_review boolean NOT NULL DEFAULT true,
  automation_allowed boolean NOT NULL DEFAULT false CHECK (automation_allowed = false),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carrier, market, code)
);

CREATE OR REPLACE VIEW read_models.integration_carrier_issue_code_registry AS
SELECT carrier,market,code,normalized_type,description_example_sanitized,first_seen_at,last_seen_at,
       occurrences,mapping_status,policy_id,human_review,automation_allowed,updated_at,
       actions_executed,production_writes
FROM integration.carrier_issue_code_registry;

GRANT SELECT, INSERT, UPDATE ON integration.carrier_issue_code_registry TO suleia_ingestion;
GRANT SELECT ON integration.carrier_issue_code_registry TO suleia_backup;
GRANT SELECT ON read_models.integration_carrier_issue_code_registry
TO suleia_mcp_readonly, suleia_operations_readonly;

COMMIT;
