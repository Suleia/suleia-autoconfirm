#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
RESTORE_DATABASE="suleia_restore_drill"

if [[ ! "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]; then
  echo "Provide a backup path such as /backups/suleia-YYYYMMDDTHHMMSSZ.dump." >&2
  exit 1
fi

compose() {
  docker compose \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    "$@"
}

cleanup() {
  compose exec --no-TTY postgres \
    dropdb --if-exists --username suleia_admin "${RESTORE_DATABASE}" \
    >/dev/null
}
trap cleanup EXIT

cleanup
compose exec --no-TTY postgres \
  createdb \
  --username suleia_admin \
  --owner suleia_backup_login \
  "${RESTORE_DATABASE}"

compose --profile maintenance run --rm \
  --env "PGDATABASE=${RESTORE_DATABASE}" \
  --env ALLOW_RESTORE=true \
  backup \
  /bin/sh /opt/suleia/backup/restore.sh "${BACKUP_FILE}"

table_count="$(
  compose exec --no-TTY postgres \
    psql \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --username suleia_admin \
    --dbname "${RESTORE_DATABASE}" \
    --command "select count(*) from information_schema.tables where table_schema in ('raw','core','events','decisions','configuration','operations','audit','mcp');"
)"

if [[ ! "${table_count}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Restore drill failed: no application tables found." >&2
  exit 1
fi

printf '{"ok":true,"restore_database":"%s","application_tables":%s,"cleanup":"scheduled"}\n' \
  "${RESTORE_DATABASE}" "${table_count}"
