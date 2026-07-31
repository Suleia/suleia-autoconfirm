#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
CONFIG_SCRIPT="${INSTALL_ROOT}/infrastructure/identity/configure-chatgpt-dcr.mjs"
CONFIG_SERVICE_CLIENT_ID="${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID:-suleia-config-service}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
if [[ -z "${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET:-}" && -z "${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:-}" ]]; then
  echo "A temporary Keycloak configuration credential is required." >&2
  exit 1
fi

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  run --rm --no-deps \
  --env KEYCLOAK_CONFIG_SERVICE_CLIENT_ID="${CONFIG_SERVICE_CLIENT_ID}" \
  --env KEYCLOAK_CONFIG_SERVICE_SECRET="${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET:-}" \
  --env KEYCLOAK_CONFIG_ADMIN_PASSWORD="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:-}" \
  --volume "${CONFIG_SCRIPT}:/tmp/configure-chatgpt-dcr.mjs:ro" \
  --entrypoint node \
  mcp-server \
  /tmp/configure-chatgpt-dcr.mjs
