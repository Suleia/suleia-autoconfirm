#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
DRILL_DATABASE="suleia_private_order_display_drill"
UP_MIGRATION="${INSTALL_ROOT}/migrations/019_operations_private_order_display.sql"
DOWN_MIGRATION="${INSTALL_ROOT}/migrations/rollback/019_operations_private_order_display.down.sql"

[[ "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]
test -r "${ENV_FILE}"
test -r "${UP_MIGRATION}"
test -r "${DOWN_MIGRATION}"

compose() { docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"; }
cleanup() { compose exec --no-TTY postgres dropdb --if-exists --username suleia_admin "${DRILL_DATABASE}" >/dev/null; }
trap cleanup EXIT

cleanup
compose exec --no-TTY postgres createdb --username suleia_admin --owner suleia_backup_login "${DRILL_DATABASE}"
compose --profile maintenance run --rm --no-TTY --env "PGDATABASE=${DRILL_DATABASE}" --env ALLOW_RESTORE=true \
  backup /bin/sh /opt/suleia/backup/restore.sh "${BACKUP_FILE}" </dev/null >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${UP_MIGRATION}" >/dev/null

up_view="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select count(*) from pg_views where schemaname='read_models' and viewname='operations_private_order_display';")"
mcp_access="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select has_table_privilege('suleia_mcp_readonly','read_models.operations_private_order_display','SELECT')::int;")"
backup_access="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select has_table_privilege('suleia_backup','read_models.operations_private_order_display','SELECT')::int;")"
[[ "${up_view}" = "1" ]]
[[ "${mcp_access}" = "0" ]]
[[ "${backup_access}" = "0" ]]

compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN_MIGRATION}" >/dev/null
down_view="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select count(*) from pg_views where schemaname='read_models' and viewname='operations_private_order_display';")"
[[ "${down_view}" = "0" ]]

cleanup
trap - EXIT
echo 'OPERATIONS_PRIVATE_ORDER_DISPLAY_ROLLBACK_DRILL|PASS|up_view=1|mcp_access=0|backup_access=0|down_view=0|actions=0|production_writes=0'
