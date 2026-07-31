#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
VERIFY_SCRIPT="${INSTALL_ROOT}/infrastructure/identity/verify-keycloak-mcp-e2e.mjs"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
: "${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:?configuration administrator secret is required}"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  run --rm --no-deps \
  --env KEYCLOAK_CONFIG_ADMIN_PASSWORD="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD}" \
  --volume "${VERIFY_SCRIPT}:/tmp/verify-keycloak-mcp-e2e.mjs:ro" \
  --entrypoint node \
  mcp-server \
  /tmp/verify-keycloak-mcp-e2e.mjs
