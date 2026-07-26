BEGIN;

DROP ROLE IF EXISTS suleia_backup;
DROP ROLE IF EXISTS suleia_mcp_readonly;
DROP ROLE IF EXISTS suleia_decision_engine;
DROP ROLE IF EXISTS suleia_ingestion;
DROP ROLE IF EXISTS suleia_api;
DROP ROLE IF EXISTS suleia_migrations;

COMMIT;
