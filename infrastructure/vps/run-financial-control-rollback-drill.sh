#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
DRILL_DATABASE="suleia_financial_control_drill"
UP="${INSTALL_ROOT}/migrations/024_financial_control.sql"
DOWN="${INSTALL_ROOT}/migrations/rollback/024_financial_control.down.sql"
[[ "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]
test -r "${ENV_FILE}"; test -r "${UP}"; test -r "${DOWN}"
compose() { docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"; }
cleanup() { compose exec --no-TTY postgres dropdb --if-exists --username suleia_admin "${DRILL_DATABASE}" >/dev/null; }
trap cleanup EXIT
cleanup
compose exec --no-TTY postgres createdb --username suleia_admin --owner suleia_backup_login "${DRILL_DATABASE}"
compose --profile maintenance run --rm --no-TTY --env "PGDATABASE=${DRILL_DATABASE}" --env ALLOW_RESTORE=true backup /bin/sh /opt/suleia/backup/restore.sh "${BACKUP_FILE}" </dev/null >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${UP}" >/dev/null
table_count="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select count(*) from pg_tables where schemaname='economics' and tablename like 'finance_%';")"
ingestion_write="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_ingestion','economics.finance_ad_spend_daily','INSERT')::int;")"
api_read="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_operations_readonly','economics.finance_ad_spend_daily','SELECT')::int;")"
mcp_read="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_mcp_readonly','economics.finance_ad_spend_daily','SELECT')::int;")"
[[ "${table_count}" = "4" && "${ingestion_write}" = "1" && "${api_read}" = "1" && "${mcp_read}" = "0" ]]
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN}" >/dev/null
down_count="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select count(*) from pg_tables where schemaname='economics' and tablename like 'finance_%';")"
[[ "${down_count}" = "0" ]]
cleanup; trap - EXIT
echo 'FINANCIAL_CONTROL_ROLLBACK_DRILL|PASS|tables=4|ingestion_write=1|api_read=1|mcp_read=0|down=0|external_actions=0|production_writes=0'
