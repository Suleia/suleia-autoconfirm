#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
DRILL_DATABASE="suleia_financial_control_drill"
UP="${INSTALL_ROOT}/migrations/024_financial_control.sql"
DOWN="${INSTALL_ROOT}/migrations/rollback/024_financial_control.down.sql"
DOWN_025="${INSTALL_ROOT}/migrations/rollback/025_dropea_order_costs.down.sql"
DOWN_026="${INSTALL_ROOT}/migrations/rollback/026_finance_product_cogs.down.sql"
DOWN_027="${INSTALL_ROOT}/migrations/rollback/027_finance_daily_profit_and_fixed_expenses.down.sql"
[[ "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]
test -r "${ENV_FILE}"; test -r "${UP}"; test -r "${DOWN}"
test -r "${DOWN_025}"; test -r "${DOWN_026}"; test -r "${DOWN_027}"
compose() { docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"; }
cleanup() { compose exec --no-TTY postgres dropdb --if-exists --username suleia_admin "${DRILL_DATABASE}" >/dev/null; }
trap cleanup EXIT
cleanup
compose exec --no-TTY postgres createdb --username suleia_admin --owner suleia_backup_login "${DRILL_DATABASE}"
compose --profile maintenance run --rm --no-TTY --env "PGDATABASE=${DRILL_DATABASE}" --env ALLOW_RESTORE=true backup /bin/sh /opt/suleia/backup/restore.sh "${BACKUP_FILE}" </dev/null >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${UP}" >/dev/null
table_count="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select count(*) from pg_tables where schemaname='economics' and tablename in ('finance_cost_rates','finance_fixed_expenses','finance_ad_spend_daily','finance_sync_checkpoints');")"
ingestion_write="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_ingestion','economics.finance_ad_spend_daily','INSERT')::int;")"
api_read="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_operations_readonly','economics.finance_ad_spend_daily','SELECT')::int;")"
mcp_read="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_mcp_readonly','economics.finance_ad_spend_daily','SELECT')::int;")"
[[ "${table_count}" = "4" && "${ingestion_write}" = "1" && "${api_read}" = "1" && "${mcp_read}" = "0" ]]
# The verified backup may already contain additive finance migrations 025-027.
# Roll them back in reverse dependency order inside the isolated drill before
# testing the base 024 rollback. The production database is never touched.
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN_027}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN_026}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN_025}" >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN}" >/dev/null
down_count="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select count(*) from pg_tables where schemaname='economics' and tablename in ('finance_cost_rates','finance_fixed_expenses','finance_ad_spend_daily','finance_sync_checkpoints');")"
[[ "${down_count}" = "0" ]]
cleanup; trap - EXIT
echo 'FINANCIAL_CONTROL_ROLLBACK_DRILL|PASS|tables=4|ingestion_write=1|api_read=1|mcp_read=0|down=0|external_actions=0|production_writes=0'
