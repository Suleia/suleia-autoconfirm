#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

bash "${INSTALL_ROOT}/infrastructure/vps/validate-mcp-db-readonly.sh"
node "${INSTALL_ROOT}/infrastructure/scripts/validate_staging_safety.mjs"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY mcp-server \
  sh -c 'test -z "${OPENAI_API_KEY:-}"'

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY mcp-server \
  sh -c 'test "${MCP_ACTION_EXECUTOR_ENABLED:-false}" = "false"'

echo "OpenAI API key is absent and the MCP action executor is disabled."
