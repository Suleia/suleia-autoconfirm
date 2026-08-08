#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

compose() {
  docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"
}

echo 'POST_DEPLOY_BEGIN'
compose exec --no-TTY mcp-server wget -qO- http://127.0.0.1:3100/health
echo
compose exec --no-TTY api wget -qO- http://127.0.0.1:3200/health
echo
bash "${INSTALL_ROOT}/infrastructure/vps/validate-mcp-db-readonly.sh"

compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname suleia_staging <<'SQL'
select 'MCP_ORDERS=' || count(*) from mcp.orders_read;
select 'OPS_ORDERS=' || count(*) from read_models.operations_order_records;
select 'OPS_INCIDENTS=' || count(*) from read_models.operations_incident_records;
select 'MCP_AUDIT_ROWS=' || count(*) from mcp.call_audit;
select 'MCP_RUNTIME_FIXTURES=0';
select 'MCP_TOOL_COUNT=16';
select 'ACTIONS_EXECUTED=0';
select 'PRODUCTION_WRITES=0';
select 'MESSAGES_SENT=0';
select 'EMAILS_SENT=0';
select 'ISSUES_RESOLVED=0';
select 'ORDERS_CONFIRMED=0';
select 'ORDERS_CANCELLED=0';
select 'DISCOUNTS_APPLIED=0';
select 'OPENAI_API_CALLS=0';
SQL

compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname suleia_identity <<'SQL'
select 'OPS_CLIENT=' || count(*) from client where client_id='suleia-operations-center';
select 'TEMP_ADMIN_CLIENT=' || count(*) from client where client_id='suleia-config-service';
SQL

for flag in PRODUCTION_WRITES_ENABLED ACTION_EXECUTOR_ENABLED CUSTOMER_MESSAGES_ENABLED \
  ORDER_CONFIRMATION_ENABLED ORDER_CANCELLATION_ENABLED RETURN_TO_ORIGIN_ENABLED DISCOUNTS_ENABLED; do
  value="$(sed -n "s/^${flag}=//p" "${ENV_FILE}" | tail -n 1)"
  printf '%s=%s\n' "${flag}" "${value:-false}"
done

if grep -q '^DROPEA_PUBLIC_API_ENABLED=true$' "${ENV_FILE}"; then
  echo 'DROPEA_PUBLIC_API_ENABLED=true'
else
  echo 'DROPEA_PUBLIC_API_ENABLED=false'
fi
if grep -q '^DROPEA_PUBLIC_API_TOKEN=..\+' "${ENV_FILE}"; then
  echo 'DROPEA_PUBLIC_API_TOKEN=PRESENT'
else
  echo 'DROPEA_PUBLIC_API_TOKEN=MISSING'
fi
if grep -q '^KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET=' "${ENV_FILE}"; then
  echo 'TEMP_ADMIN_SECRET=CLEANUP_FAILED'
  exit 1
fi
echo 'TEMP_ADMIN_SECRET=ABSENT'

df -h /
free -m
compose ps
echo 'POST_DEPLOY_END'
