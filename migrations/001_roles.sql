BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_migrations') THEN
    CREATE ROLE suleia_migrations NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_api') THEN
    CREATE ROLE suleia_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_ingestion') THEN
    CREATE ROLE suleia_ingestion NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_decision_engine') THEN
    CREATE ROLE suleia_decision_engine NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_mcp_readonly') THEN
    CREATE ROLE suleia_mcp_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_backup') THEN
    CREATE ROLE suleia_backup NOLOGIN;
  END IF;
END
$$;

ALTER ROLE suleia_mcp_readonly SET default_transaction_read_only = on;

COMMIT;
