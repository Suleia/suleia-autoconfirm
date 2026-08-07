#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
DRILL_DATABASE="suleia_data_model_hardening_drill"
UP_MIGRATION="${INSTALL_ROOT}/migrations/014_operational_data_model_hardening.sql"
DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/014_operational_data_model_hardening.down.sql"

[[ "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]
test -r "${ENV_FILE}"
test -r "${UP_MIGRATION}"
test -r "${DOWN_MIGRATION}"
compose() { docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"; }
cleanup() { compose exec --no-TTY postgres dropdb --if-exists --username suleia_admin "${DRILL_DATABASE}" >/dev/null; }
trap cleanup EXIT

cleanup
compose exec --no-TTY postgres createdb --username suleia_admin --owner suleia_backup_login "${DRILL_DATABASE}"
compose --profile maintenance run --rm --env "PGDATABASE=${DRILL_DATABASE}" --env ALLOW_RESTORE=true \
  backup /bin/sh /opt/suleia/backup/restore.sh "${BACKUP_FILE}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${UP_MIGRATION}" >/dev/null

created="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select count(*) from information_schema.views where table_schema='read_models' and table_name in ('operations_order_context','operations_incident_context','operations_order_timeline','operations_data_quality','reconciliation_findings');")"
[[ "${created}" = "5" ]]

compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN_MIGRATION}" >/dev/null
remaining="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select count(*) from information_schema.views where table_schema='read_models' and table_name in ('operations_order_context','operations_incident_context','operations_order_timeline','operations_data_quality','reconciliation_findings');")"
[[ "${remaining}" = "0" ]]
echo 'OPERATIONAL_DATA_MODEL_HARDENING_ROLLBACK_DRILL|PASS|created=5|remaining=0|actions=0|production_writes=0'
