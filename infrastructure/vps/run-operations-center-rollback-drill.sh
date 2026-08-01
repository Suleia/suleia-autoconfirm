#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
DRILL_DATABASE="suleia_operations_rollback_drill"
UP_MIGRATION="${INSTALL_ROOT}/migrations/006_operations_center_read_models.sql"
DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/006_operations_center_read_models.down.sql"

if [[ ! "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]; then
  echo "Provide a verified backup path under /backups." >&2
  exit 1
fi
test -r "${ENV_FILE}"
test -r "${UP_MIGRATION}"
test -r "${DOWN_MIGRATION}"

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
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${UP_MIGRATION}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN_MIGRATION}" >/dev/null

remaining="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" \
  --command "select count(*) from information_schema.tables where table_schema='read_models' and table_name like 'operations_%';")"
if [[ "${remaining}" != "0" ]]; then
  echo "Operations Center rollback drill left schema objects behind." >&2
  exit 1
fi

echo 'OPERATIONS_ROLLBACK_DRILL|PASS|remaining_objects=0|actions=0|production_writes=0'
