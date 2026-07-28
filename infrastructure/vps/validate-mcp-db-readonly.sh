#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

compose() {
  docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"
}

compose exec --no-TTY postgres psql \
  --no-psqlrc \
  --tuples-only \
  --no-align \
  --field-separator=, \
  --username suleia_admin \
  --dbname suleia_staging <<'SQL'
SELECT 'role_exists', EXISTS(
  SELECT 1 FROM pg_roles WHERE rolname = 'suleia_mcp_readonly'
);
SELECT 'role_escalation_flags', rolsuper, rolcreaterole, rolcreatedb
FROM pg_roles
WHERE rolname = 'suleia_mcp_readonly';
SELECT 'database_create',
  has_database_privilege('suleia_mcp_readonly', current_database(), 'CREATE');
SELECT 'core_orders_privileges',
  has_table_privilege('suleia_mcp_readonly', 'core.orders', 'SELECT'),
  has_table_privilege('suleia_mcp_readonly', 'core.orders', 'INSERT'),
  has_table_privilege('suleia_mcp_readonly', 'core.orders', 'UPDATE'),
  has_table_privilege('suleia_mcp_readonly', 'core.orders', 'DELETE');
SELECT 'masked_view_select',
  has_table_privilege('suleia_mcp_readonly', 'mcp.orders_read', 'SELECT');
SQL

if compose exec --no-TTY postgres psql \
  --no-psqlrc \
  --set ON_ERROR_STOP=1 \
  --username suleia_admin \
  --dbname suleia_staging \
  --command "SET ROLE suleia_mcp_readonly; INSERT INTO core.orders DEFAULT VALUES;" \
  >/dev/null 2>&1; then
  echo "write_attempt,unexpectedly_allowed"
  exit 1
fi

echo "write_attempt,blocked"

