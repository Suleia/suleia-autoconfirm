#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
MIGRATION_FILE="${INSTALL_ROOT}/migrations/007_operational_protections.sql"

if [[ ! -r "${ENV_FILE}" || ! -r "${MIGRATION_FILE}" ]]; then
  echo "Operational protections migration inputs are missing." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" < "${MIGRATION_FILE}"

echo "Operational protections migration applied with write flags unchanged."
