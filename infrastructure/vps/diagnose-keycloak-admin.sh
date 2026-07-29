#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

container_password="$(
  docker compose \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    exec --no-TTY keycloak \
    printenv KC_BOOTSTRAP_ADMIN_PASSWORD
)"

if [[ "${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD}" != "${container_password}" ]]; then
  echo "Keycloak administrator password mismatch between .env and container." >&2
  exit 1
fi

echo "Keycloak administrator password source is consistent."

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY \
  --env KC_CLI_PASSWORD="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD}" \
  keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://127.0.0.1:8080/auth \
  --realm master \
  --user suleia-config-admin >/dev/null

echo "Keycloak administrator authentication succeeded."
