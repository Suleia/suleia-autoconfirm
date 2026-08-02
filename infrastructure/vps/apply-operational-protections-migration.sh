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

state="$(docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --tuples-only --no-align --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" --command \
  "select (to_regclass('operations.active_customer_product_guard') is not null)::int +
          (to_regclass('read_models.operations_protection_summary') is not null)::int +
          (exists(select 1 from information_schema.columns where table_schema='read_models'
                  and table_name='operations_order_records' and column_name='lifecycle_classification'))::int;")"
if [[ "${state}" = "3" ]]; then
  echo "Operational protections migration already present; skipped safely."
  exit 0
fi
if [[ "${state}" != "0" ]]; then
  echo "Operational protections migration is partially applied; refusing to guess." >&2
  exit 1
fi

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" < "${MIGRATION_FILE}"

echo "Operational protections migration applied with write flags unchanged."
