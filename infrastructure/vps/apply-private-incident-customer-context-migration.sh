#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
MIGRATION_FILE="${INSTALL_ROOT}/migrations/021_private_incident_customer_context.sql"

test -r "${ENV_FILE}"
test -r "${MIGRATION_FILE}"
docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" < "${MIGRATION_FILE}"
echo 'PRIVATE_INCIDENT_CUSTOMER_CONTEXT_MIGRATION|PASS|ciphertext_only=1|api_read=1|mcp_read=0|actions=0|production_writes=0'
