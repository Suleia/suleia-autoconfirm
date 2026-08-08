BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_platform_audit_readonly') THEN
    CREATE ROLE suleia_platform_audit_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE suleia_platform_audit_readonly SET default_transaction_read_only = on;
ALTER ROLE suleia_mcp_readonly SET default_transaction_read_only = on;

-- Earlier prototypes allowed the MCP group to append its database audit rows.
-- Runtime auditing now uses the dedicated structured logger, so both database
-- roles are strictly SELECT-only.
REVOKE INSERT ON mcp.call_audit,mcp.tool_executions,mcp.security_events FROM suleia_mcp_readonly;

REVOKE CREATE ON SCHEMA public FROM suleia_mcp_readonly,suleia_platform_audit_readonly;
DO $$
BEGIN
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM suleia_mcp_readonly,suleia_platform_audit_readonly', current_database());
END
$$;

-- Platform tools query only predefined pg_catalog/information_schema metadata.
-- No base-table DML or DDL privileges are granted to this role.
GRANT USAGE ON SCHEMA read_models TO suleia_platform_audit_readonly;

COMMIT;
