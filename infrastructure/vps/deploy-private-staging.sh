#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Compose file not found at ${COMPOSE_FILE}." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  umask 077
  {
    cat <<'EOF'
APP_ENV=staging
RUN_MODE=SIMULATION
SIMULATION_ONLY=true
PRODUCTION_WRITES_ENABLED=false
ACTION_EXECUTOR_ENABLED=false
MCP_WRITE_TOOLS_ENABLED=false
OPENAI_API_ENABLED=false
OPENAI_API_AUTOMATION_ENABLED=false
EXTERNAL_LLM_CALLS_ENABLED=false
LIVE_WEBHOOKS_ENABLED=false
LIVE_CRON_ENABLED=false
LIVE_POLLING_ENABLED=false
PII_MASKING_ENABLED=true
AUDIT_LOGGING_ENABLED=true
DETERMINISTIC_AUTO_ROUTE_CONFIDENCE=0.95
AI_REVIEW_ROUTE_MIN_CONFIDENCE=0.60
HUMAN_REVIEW_REQUIRED_RISK=HIGH
CRITICAL_ALWAYS_BLOCKED=true
OPS_STAGING_HOST=ops-staging.localhost
API_STAGING_HOST=api-staging.localhost
MCP_STAGING_HOST=mcp-staging.localhost
POSTGRES_DB=suleia_staging
MCP_DATA_MODE=fixture
MCP_AUTH_MODE=bearer
MCP_GRANTED_SCOPES=orders:read,orders:simulate
MCP_RATE_LIMIT_PER_MINUTE=60
MCP_AUDIT_MODE=stderr
READ_ONLY=true
SHOPIFY_ACCESS_TOKEN=
DROPEA_ACCESS_TOKEN=
CHATBY_TOKEN=
GLS_TOKEN=
BACKUP_DAILY_RETENTION_DAYS=14
BACKUP_WEEKLY_RETENTION_WEEKS=8
BACKUP_MONTHLY_RETENTION_MONTHS=12
BACKUP_RETENTION_STATUS=PENDING_LEGAL_APPROVAL
EOF
    printf 'POSTGRES_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SULEIA_API_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SULEIA_INGESTION_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SULEIA_DECISION_ENGINE_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SULEIA_MCP_READONLY_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SULEIA_BACKUP_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'MCP_STAGING_BEARER_TOKEN=%s\n' "$(openssl rand -hex 32)"
  } > "${ENV_FILE}"
  chmod 0600 "${ENV_FILE}"
fi

docker run --rm \
  --volume "${INSTALL_ROOT}:/workspace:ro" \
  --workdir /workspace \
  node:22.22.0-alpine \
  node infrastructure/scripts/validate_staging_safety.mjs

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  config --quiet

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  build

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  up --detach --wait --wait-timeout 180

"${INSTALL_ROOT}/infrastructure/vps/provision-staging-db-logins.sh"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  ps
