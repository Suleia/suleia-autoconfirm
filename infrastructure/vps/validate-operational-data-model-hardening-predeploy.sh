#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
UP_MIGRATION="${1:-/tmp/014_operational_data_model_hardening.sql}"
DOWN_MIGRATION="${2:-/tmp/014_operational_data_model_hardening.down.sql}"
DRILL_DATABASE="suleia_data_model_hardening_predeploy"

test -r "${UP_MIGRATION}"
test -r "${DOWN_MIGRATION}"
compose() { docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"; }
cleanup() {
  compose exec --no-TTY postgres dropdb --if-exists --username suleia_admin "${DRILL_DATABASE}" >/dev/null
  compose exec --no-TTY postgres rm -f /tmp/014_up.sql /tmp/014_down.sql /tmp/014_snapshot.dump >/dev/null
  rm -f /tmp/014_incident_explain.txt /tmp/014_order_explain.txt
}
trap cleanup EXIT

cleanup
container="$(compose ps --quiet postgres)"
docker cp "${UP_MIGRATION}" "${container}:/tmp/014_up.sql"
docker cp "${DOWN_MIGRATION}" "${container}:/tmp/014_down.sql"
compose exec --no-TTY postgres pg_dump --username suleia_admin --dbname suleia_staging \
  --format custom --file /tmp/014_snapshot.dump
compose exec --no-TTY postgres createdb --username suleia_admin --owner suleia_backup_login "${DRILL_DATABASE}"
compose exec --no-TTY postgres pg_restore --username suleia_admin --dbname "${DRILL_DATABASE}" \
  --no-owner --no-privileges /tmp/014_snapshot.dump
compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --file /tmp/014_up.sql

created="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select count(*) from information_schema.views where table_schema='read_models' and table_name in ('operations_order_context','operations_incident_context','operations_order_timeline','operations_data_quality','reconciliation_findings');")"
[[ "${created}" = "5" ]]

compose exec --no-TTY postgres psql --no-psqlrc --username suleia_admin --dbname "${DRILL_DATABASE}" \
  --command "EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM read_models.operations_incident_context WHERE status='PENDING' AND is_active=true ORDER BY updated_at DESC LIMIT 50;" \
  > /tmp/014_incident_explain.txt
compose exec --no-TTY postgres psql --no-psqlrc --username suleia_admin --dbname "${DRILL_DATABASE}" \
  --command "EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM read_models.operations_order_context ORDER BY updated_at_utc DESC LIMIT 50;" \
  > /tmp/014_order_explain.txt

incident_execution_ms="$(awk '/Execution Time:/ {print $(NF-1)}' /tmp/014_incident_explain.txt)"
order_execution_ms="$(awk '/Execution Time:/ {print $(NF-1)}' /tmp/014_order_explain.txt)"
incident_order_index_uses="$(grep -c 'operations_incidents_order_updated_idx' /tmp/014_order_explain.txt || true)"
printf 'EXPLAIN_SUMMARY|incident_ms=%s|order_ms=%s|canonical_incident_index_uses=%s\n' \
  "${incident_execution_ms}" "${order_execution_ms}" "${incident_order_index_uses}"

compose exec --no-TTY postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --file /tmp/014_down.sql
remaining="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${DRILL_DATABASE}" --command \
  "select count(*) from information_schema.views where table_schema='read_models' and table_name in ('operations_order_context','operations_incident_context','operations_order_timeline','operations_data_quality','reconciliation_findings');")"
[[ "${remaining}" = "0" ]]
echo 'OPERATIONAL_DATA_MODEL_PREDEPLOY|PASS|views=5|rollback_remaining=0|actions=0|production_writes=0'
