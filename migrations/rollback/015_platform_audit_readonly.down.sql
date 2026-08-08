BEGIN;

REVOKE suleia_platform_audit_readonly FROM suleia_mcp_readonly_login;
GRANT INSERT ON mcp.call_audit,mcp.tool_executions,mcp.security_events TO suleia_mcp_readonly;
REVOKE ALL ON SCHEMA read_models FROM suleia_platform_audit_readonly;
DROP ROLE IF EXISTS suleia_platform_audit_readonly;

COMMIT;
