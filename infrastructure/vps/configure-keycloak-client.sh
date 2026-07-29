#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
MAPPER_FILE="${INSTALL_ROOT}/infrastructure/identity/realm-role-mapper.json"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  cp "${MAPPER_FILE}" keycloak:/tmp/realm-role-mapper.json

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY \
  --env KC_CLI_PASSWORD="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD}" \
  keycloak sh -s <<'INNER'
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh
"${KCADM}" config credentials \
  --server http://127.0.0.1:8080/auth \
  --realm master \
  --user suleia-config-admin >/dev/null

client_uuid="$("${KCADM}" get clients \
  --realm suleia \
  --query clientId=chatgpt-suleia-mcp \
  --fields id \
  --format csv \
  --noquotes)"
test -n "${client_uuid}"

mapper_names="$("${KCADM}" get "clients/${client_uuid}/protocol-mappers/models" \
  --realm suleia \
  --fields name \
  --format csv \
  --noquotes)"

if ! printf '%s\n' "${mapper_names}" | grep -Fxq suleia-realm-roles; then
  "${KCADM}" create "clients/${client_uuid}/protocol-mappers/models" \
    --realm suleia \
    --file /tmp/realm-role-mapper.json >/dev/null
fi

"${KCADM}" get roles/mcp_reader \
  --realm suleia \
  --fields name >/dev/null

mapper_names="$("${KCADM}" get "clients/${client_uuid}/protocol-mappers/models" \
  --realm suleia \
  --fields name \
  --format csv \
  --noquotes)"
printf '%s\n' "${mapper_names}" | grep -Fxq suleia-realm-roles

echo "Keycloak MCP client, reader role and realm-role mapper are configured."
INNER
