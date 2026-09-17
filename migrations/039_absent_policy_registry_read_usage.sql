BEGIN;
-- 037 grants SELECT on the registry, but the real MCP read role also needs
-- schema USAGE. This grants no CREATE, mutation or access to other objects.
GRANT USAGE ON SCHEMA configuration TO suleia_mcp_readonly,suleia_operations_readonly;
COMMIT;
