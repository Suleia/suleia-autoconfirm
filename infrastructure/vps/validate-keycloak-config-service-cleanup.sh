#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
SECRET_NAME="KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET"

service_count="$(
  docker compose \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    exec --no-TTY postgres \
    psql \
    --username suleia_admin \
    --dbname suleia_identity \
    --tuples-only \
    --no-align \
    --command "SELECT count(*) FROM client WHERE client_id = 'suleia-config-service';"
)"

secret_count="$(grep -c "^${SECRET_NAME}=" "${ENV_FILE}" || true)"

echo "temporary_service_count=${service_count}"
echo "temporary_secret_count=${secret_count}"
test "${service_count}" = "0"
test "${secret_count}" = "0"

echo "Keycloak temporary configuration credentials are absent."
