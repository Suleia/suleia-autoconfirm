#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
MIGRATION_FILE="${INSTALL_ROOT}/migrations/018_order_chatby_signal_projection.sql"

test -r "${ENV_FILE}"
test -r "${MIGRATION_FILE}"

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" < "${MIGRATION_FILE}"

echo 'ORDER_CHATBY_SIGNAL_PROJECTION_MIGRATION|PASS|internal_schema_writes=1|actions=0|production_writes=0'
