#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"
DRILL_DATABASE="suleia_incident_feedback_drill"
UP="${INSTALL_ROOT}/migrations/020_incident_truth_feedback.sql"
DOWN="${INSTALL_ROOT}/migrations/rollback/020_incident_truth_feedback.down.sql"
[[ "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]
test -r "${ENV_FILE}"; test -r "${UP}"; test -r "${DOWN}"
compose() { docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"; }
cleanup() { compose exec --no-TTY postgres dropdb --if-exists --username suleia_admin "${DRILL_DATABASE}" >/dev/null; }
trap cleanup EXIT
cleanup
compose exec --no-TTY postgres createdb --username suleia_admin --owner suleia_backup_login "${DRILL_DATABASE}"
compose --profile maintenance run --rm --no-TTY --env "PGDATABASE=${DRILL_DATABASE}" --env ALLOW_RESTORE=true backup /bin/sh /opt/suleia/backup/restore.sh "${BACKUP_FILE}" </dev/null >/dev/null
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${UP}" >/dev/null
table_count="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select count(*) from pg_tables where schemaname='decision_memory' and tablename='incident_recommendation_feedback';")"
api_insert="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_operations_readonly','decision_memory.incident_recommendation_feedback','INSERT')::int;")"
mcp_insert="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select has_table_privilege('suleia_mcp_readonly','decision_memory.incident_recommendation_feedback','INSERT')::int;")"
[[ "${table_count}" = "1" && "${api_insert}" = "1" && "${mcp_insert}" = "0" ]]
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname "${DRILL_DATABASE}" < "${DOWN}" >/dev/null
down_count="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align --username suleia_admin --dbname "${DRILL_DATABASE}" --command "select count(*) from pg_tables where schemaname='decision_memory' and tablename='incident_recommendation_feedback';")"
[[ "${down_count}" = "0" ]]
cleanup; trap - EXIT
echo 'INCIDENT_TRUTH_FEEDBACK_ROLLBACK_DRILL|PASS|table=1|api_insert=1|mcp_insert=0|down=0|actions=0|production_writes=0'
