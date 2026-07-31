#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
: "${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET:?configuration service secret is required}"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  stop keycloak

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  run --rm --no-deps \
  --env KC_BOOTSTRAP_ADMIN_CLIENT_SECRET="${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET}" \
  keycloak \
  bootstrap-admin service \
  --optimized \
  --no-prompt \
  --client-id suleia-config-service \
  --client-secret:env KC_BOOTSTRAP_ADMIN_CLIENT_SECRET

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  up --detach keycloak

for attempt in $(seq 1 60); do
  if docker compose \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    exec --no-TTY mcp-edge \
    wget -qO- http://keycloak:9000/auth/health/ready 2>/dev/null \
    | grep -q '"status": "UP"'; then
    echo "Keycloak configuration service is ready."
    exit 0
  fi
  sleep 2
done

echo "Keycloak did not become ready in time." >&2
exit 1
