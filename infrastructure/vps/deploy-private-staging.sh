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
RUN_MODE=SHADOW_READ_ONLY
SIMULATION_ONLY=true
PRODUCTION_WRITES_ENABLED=false
ACTION_EXECUTOR_ENABLED=false
MCP_WRITE_TOOLS_ENABLED=false
OPENAI_API_ENABLED=false
OPENAI_API_AUTOMATION_ENABLED=false
OPENAI_RESPONSES_API_ENABLED=false
OPENAI_ASSISTANTS_API_ENABLED=false
OPENAI_CHAT_COMPLETIONS_ENABLED=false
EXTERNAL_LLM_CALLS_ENABLED=false
LOCAL_LLM_ENABLED=false
REAL_DATA_WRITE_ENABLED=false
CONNECTOR_WRITE_ENABLED=false
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
MCP_PUBLIC_ENDPOINT_ENABLED=false
MCP_GRANTED_SCOPES=orders:read,timelines:read,decisions:read,reviews:read,orders:simulate
MCP_RATE_LIMIT_PER_MINUTE=30
MCP_REQUEST_BODY_LIMIT=64kb
MCP_TOOL_TIMEOUT_MS=10000
MCP_MAX_RESPONSE_BYTES=51200
MCP_AUDIT_MODE=stderr
READ_ONLY=true
REAL_DATA_READ_ENABLED=true
DROPEA_READ_ENABLED=true
DROPEA_WRITE_ENABLED=false
DROPEA_MUTATION_CLIENT_ENABLED=false
CHATBY_READ_ENABLED=true
CHATBY_WRITE_ENABLED=false
GLS_WRITE_ENABLED=false
INCIDENT_INTERPRETATION_ENABLED=true
INCIDENT_DECISION_ENABLED=true
INCIDENT_SIMULATION_ENABLED=true
ISSUE_RESOLUTION_ENABLED=false
RETURN_EXECUTION_ENABLED=false
ADDRESS_UPDATE_ENABLED=false
TEMPLATE_SENDING_ENABLED=false
DISCOUNT_SENDING_ENABLED=false
EMAIL_SENDING_ENABLED=false
EXTERNAL_AI_CALLS_ENABLED=false
SHOPIFY_ACCESS_TOKEN=
DROPEA_ACCESS_TOKEN=
DROPEA_PUBLIC_API_ENABLED=false
DROPEA_READ_JWT_ES=
DROPEA_STORES_CONFIG=[]
DROPEA_INGESTION_PHASE=CANARY
DROPEA_INGESTION_DRY_RUN=true
DROPEA_PUBLIC_API_RATE_LIMIT=45
DROPEA_WEBHOOK_AUTH_MODE=HMAC_ONLY
DROPEA_WEBHOOK_HMAC_SECRET=
DROPEA_WEBHOOK_PATH_TOKEN_SHA256=
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

ensure_env_value() {
  local name="$1"
  local value="$2"
  if grep -q "^${name}=" "${ENV_FILE}"; then
    sed -i "s|^${name}=.*$|${name}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${name}" "${value}" >> "${ENV_FILE}"
  fi
}

ensure_secret() {
  local name="$1"
  if ! grep -q "^${name}=.\+" "${ENV_FILE}"; then
    printf '%s=%s\n' "${name}" "$(openssl rand -hex 32)" >> "${ENV_FILE}"
  fi
}

ensure_env_value MCP_PUBLIC_HOST mcp.suleia.com
ensure_env_value OPS_PUBLIC_HOST ops-staging.localhost
ensure_env_value MCP_AUTH_MODE oauth
ensure_env_value MCP_PUBLIC_ENDPOINT_ENABLED true
ensure_env_value RUN_MODE SHADOW_READ_ONLY
ensure_env_value SIMULATION_ONLY true
ensure_env_value REAL_DATA_READ_ENABLED true
ensure_env_value DROPEA_READ_ENABLED true
ensure_env_value DROPEA_WRITE_ENABLED false
ensure_env_value DROPEA_MUTATION_CLIENT_ENABLED false
ensure_env_value CHATBY_READ_ENABLED true
ensure_env_value CHATBY_WRITE_ENABLED false
ensure_env_value GLS_WRITE_ENABLED false
ensure_env_value INCIDENT_INTERPRETATION_ENABLED true
ensure_env_value INCIDENT_DECISION_ENABLED true
ensure_env_value INCIDENT_SIMULATION_ENABLED true
ensure_env_value ISSUE_RESOLUTION_ENABLED false
ensure_env_value RETURN_EXECUTION_ENABLED false
ensure_env_value ADDRESS_UPDATE_ENABLED false
ensure_env_value TEMPLATE_SENDING_ENABLED false
ensure_env_value DISCOUNT_SENDING_ENABLED false
ensure_env_value EMAIL_SENDING_ENABLED false
ensure_env_value EXTERNAL_AI_CALLS_ENABLED false
ensure_env_value DROPEA_INGESTION_DRY_RUN true
ensure_secret SULEIA_KEYCLOAK_DB_PASSWORD
chmod 0600 "${ENV_FILE}"

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
  up --detach --wait --wait-timeout 180 postgres

bash "${INSTALL_ROOT}/infrastructure/vps/apply-operations-center-migration.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/apply-operational-protections-migration.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/apply-incident-handbook-migration.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/apply-dropea-v2-read-mirror-migration.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/apply-dropea-complete-history-migration.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/apply-operations-readonly-permissions.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/provision-staging-db-logins.sh"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  up --detach --wait --wait-timeout 300

bash "${INSTALL_ROOT}/infrastructure/vps/apply-operations-keycloak.sh"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  ps
