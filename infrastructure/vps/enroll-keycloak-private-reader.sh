#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
ENROLL_SCRIPT="${INSTALL_ROOT}/infrastructure/identity/enroll-keycloak-private-reader.mjs"

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
  --volume "${ENROLL_SCRIPT}:/tmp/enroll-keycloak-private-reader.mjs:ro" \
  --entrypoint node \
  mcp-server \
  /tmp/enroll-keycloak-private-reader.mjs
