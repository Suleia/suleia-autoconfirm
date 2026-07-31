#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

test -r "${ENV_FILE}"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required_false=(PRODUCTION_WRITES_ENABLED ACTION_EXECUTOR_ENABLED MCP_WRITE_TOOLS_ENABLED OPENAI_API_ENABLED OPENAI_API_AUTOMATION_ENABLED EXTERNAL_LLM_CALLS_ENABLED REAL_DATA_WRITE_ENABLED CONNECTOR_WRITE_ENABLED CUSTOMER_MESSAGES_ENABLED ORDER_CONFIRMATION_ENABLED ORDER_CANCELLATION_ENABLED RETURN_TO_ORIGIN_ENABLED DISCOUNTS_ENABLED)
for name in "${required_false[@]}"; do
  value="${!name:-false}"
  test "${value}" = "false" || { echo "SHADOW_VERIFY|FAIL|unsafe_flag=${name}" >&2; exit 1; }
done
test "${PII_MASKING_ENABLED:-true}" = "true"
test "${AUDIT_LOGGING_ENABLED:-true}" = "true"

query() {
  docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
    psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --username suleia_admin --dbname "${POSTGRES_DB:-suleia_staging}" --command "$1" </dev/null
}

unsafe_rows="$(query "SELECT count(*) FROM raw_private.source_records WHERE payload_masked::text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}' OR payload_masked::text ~* '\"(authorization|password|secret|token|api[_-]?key)\"[[:space:]]*:';")"
action_rows="$(query "SELECT COALESCE(sum(actions_executed),0) || '|' || COALESCE(sum(production_writes),0) FROM migration.batches;")"
batch_rows="$(query "SELECT count(*) FROM migration.batches;")"
record_rows="$(query "SELECT count(*) FROM raw_private.source_records;")"
failed_rows="$(query "SELECT count(*) FROM migration.batches WHERE status <> 'COMPLETED';")"

test "${unsafe_rows}" = "0" || { echo "SHADOW_VERIFY|FAIL|unsafe_rows=${unsafe_rows}" >&2; exit 1; }
test "${action_rows}" = "0|0" || { echo "SHADOW_VERIFY|FAIL|action_counters=${action_rows}" >&2; exit 1; }
test "${failed_rows}" = "0" || { echo "SHADOW_VERIFY|FAIL|failed_batches=${failed_rows}" >&2; exit 1; }
echo "SHADOW_VERIFY|PASS|batches=${batch_rows}|masked_records=${record_rows}|unsafe_rows=0|actions=0|production_writes=0"
