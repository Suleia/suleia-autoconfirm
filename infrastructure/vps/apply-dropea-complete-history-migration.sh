#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
MIGRATION_FILE="${INSTALL_ROOT}/migrations/010_dropea_complete_history.sql"
test -r "${ENV_FILE}"; test -r "${MIGRATION_FILE}"
set -a; source "${ENV_FILE}"; set +a
state="$(docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --tuples-only --no-align --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" --command \
  "select count(*) from information_schema.tables where table_schema='integration' and table_name='carrier_issue_code_registry';")"
if [[ "${state}" = "1" ]]; then
  echo 'Dropea complete-history migration already present; skipped safely.'
  exit 0
fi
if [[ "${state}" != "0" ]]; then
  echo 'Dropea complete-history migration is partially applied; refusing to guess.' >&2
  exit 1
fi
docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" < "${MIGRATION_FILE}"
echo 'DROPEA_COMPLETE_HISTORY_MIGRATION|PASS|actions=0|production_writes=0'
