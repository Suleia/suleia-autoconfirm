#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  stop keycloak

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  run --rm --no-deps keycloak \
  bootstrap-admin user \
  --no-prompt \
  --username suleia-config-admin \
  --password:env KC_BOOTSTRAP_ADMIN_PASSWORD

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
    echo "Keycloak configuration administrator is ready."
    exit 0
  fi
  sleep 2
done

echo "Keycloak did not become ready in time." >&2
exit 1
