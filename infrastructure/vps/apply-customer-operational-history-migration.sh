#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
MIGRATION_FILE="${INSTALL_ROOT}/migrations/012_customer_operational_history.sql"
test -r "${ENV_FILE}"; test -r "${MIGRATION_FILE}"
state="$(docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --tuples-only --no-align --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" --command \
  "select count(*) from information_schema.views where table_schema='read_models' and table_name='customer_operational_history';")"
if [[ "${state}" = "1" ]]; then
  echo 'Customer operational history migration already present; skipped safely.'
  exit 0
fi
if [[ "${state}" != "0" ]]; then
  echo 'Customer operational history migration is partially applied; refusing to guess.' >&2
  exit 1
fi
docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" < "${MIGRATION_FILE}"
echo 'CUSTOMER_OPERATIONAL_HISTORY_MIGRATION|PASS|actions=0|production_writes=0'

