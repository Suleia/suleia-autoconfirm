#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
DRILL_DATABASE="suleia_operations_rollback_drill"
CUSTOMER_HISTORY_DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/012_customer_operational_history.down.sql"
COMPLETE_HISTORY_DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/010_dropea_complete_history.down.sql"
V2_DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/009_dropea_v2_real_read_mirror.down.sql"
INCIDENT_DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/008_incident_management_handbook.down.sql"
PROTECTIONS_DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/007_operational_protections.down.sql"
OPERATIONS_DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/006_operations_center_read_models.down.sql"

if [[ ! "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]; then
  echo "Provide a verified backup path under /backups." >&2
  exit 1
fi
test -r "${ENV_FILE}"
test -r "${CUSTOMER_HISTORY_DOWN_MIGRATION}"
test -r "${COMPLETE_HISTORY_DOWN_MIGRATION}"
test -r "${V2_DOWN_MIGRATION}"
test -r "${INCIDENT_DOWN_MIGRATION}"
test -r "${PROTECTIONS_DOWN_MIGRATION}"
test -r "${OPERATIONS_DOWN_MIGRATION}"

compose() {
  docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"
}

cleanup() {
  compose exec --no-TTY postgres dropdb --if-exists --username suleia_admin "${DRILL_DATABASE}" >/dev/null
}
trap cleanup EXIT

cleanup
compose exec --no-TTY postgres createdb --username suleia_admin --owner suleia_backup_login "${DRILL_DATABASE}"
compose --profile maintenance run --rm --env "PGDATABASE=${DRILL_DATABASE}" --env ALLOW_RESTORE=true \
  backup /bin/sh /opt/suleia/backup/restore.sh "${BACKUP_FILE}" >/dev/null

compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${CUSTOMER_HISTORY_DOWN_MIGRATION}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${COMPLETE_HISTORY_DOWN_MIGRATION}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${V2_DOWN_MIGRATION}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${INCIDENT_DOWN_MIGRATION}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${PROTECTIONS_DOWN_MIGRATION}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${OPERATIONS_DOWN_MIGRATION}" >/dev/null

remaining="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" \
  --command "select count(*) from information_schema.tables where table_schema='read_models' and table_name like 'operations_%';")"
if [[ "${remaining}" != "0" ]]; then
  echo "Operations Center rollback drill left schema objects behind." >&2
  exit 1
fi

echo 'OPERATIONS_ROLLBACK_DRILL|PASS|remaining_objects=0|actions=0|production_writes=0'
