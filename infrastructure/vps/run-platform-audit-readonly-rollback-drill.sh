#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"

docker run --rm --network none \
  --volume "${INSTALL_ROOT}/migrations:/migrations:ro" \
  postgres:17.5-alpine sh -s <<'SCRIPT'
set -Eeuo pipefail
initdb -D /tmp/pgdata -A trust -U suleia_admin >/dev/null
pg_ctl -D /tmp/pgdata -o "-c listen_addresses='' -k /tmp" -w start >/dev/null
trap 'pg_ctl -D /tmp/pgdata -w stop >/dev/null' EXIT
createdb -h /tmp -U suleia_admin suleia_drill
psql -h /tmp -U suleia_admin -d suleia_drill -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE ROLE suleia_mcp_readonly NOLOGIN;
CREATE ROLE suleia_mcp_readonly_login LOGIN;
CREATE SCHEMA mcp;
CREATE SCHEMA read_models;
CREATE TABLE mcp.call_audit(id integer);
CREATE TABLE mcp.tool_executions(id integer);
CREATE TABLE mcp.security_events(id integer);
GRANT INSERT ON mcp.call_audit,mcp.tool_executions,mcp.security_events TO suleia_mcp_readonly;
GRANT suleia_mcp_readonly TO suleia_mcp_readonly_login;
SQL
psql -h /tmp -U suleia_admin -d suleia_drill -v ON_ERROR_STOP=1 -f /migrations/015_platform_audit_readonly.sql >/dev/null
psql -h /tmp -U suleia_admin -d suleia_drill -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
GRANT suleia_mcp_readonly TO suleia_mcp_readonly_login WITH INHERIT TRUE, SET FALSE;
GRANT suleia_platform_audit_readonly TO suleia_mcp_readonly_login WITH INHERIT TRUE, SET FALSE;
DO $$
BEGIN
  IF has_table_privilege('suleia_mcp_readonly','mcp.call_audit','INSERT') THEN RAISE EXCEPTION 'MCP INSERT remained'; END IF;
  IF has_database_privilege('suleia_platform_audit_readonly',current_database(),'CREATE') THEN RAISE EXCEPTION 'platform CREATE remained'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member
    WHERE u.rolname='suleia_mcp_readonly_login'
      AND r.rolname IN ('suleia_mcp_readonly','suleia_platform_audit_readonly') AND m.set_option
  ) THEN RAISE EXCEPTION 'SET ROLE option remained'; END IF;
END
$$;
SQL
if psql -h /tmp -U suleia_mcp_readonly_login -d suleia_drill -v ON_ERROR_STOP=1 \
  -c 'SET ROLE suleia_platform_audit_readonly' >/dev/null 2>&1; then
  echo 'SET ROLE unexpectedly succeeded' >&2
  exit 1
fi
psql -h /tmp -U suleia_admin -d suleia_drill -v ON_ERROR_STOP=1 \
  -f /migrations/rollback/015_platform_audit_readonly.down.sql >/dev/null
remaining="$(psql -h /tmp -U suleia_admin -d suleia_drill -Atc \
  "SELECT count(*) FROM pg_roles WHERE rolname='suleia_platform_audit_readonly'")"
[ "${remaining}" = "0" ]
SCRIPT

echo 'PLATFORM_AUDIT_READONLY_ROLLBACK_DRILL|PASS|set_role=blocked|writes=blocked|remaining=0|actions=0|production_writes=0'
