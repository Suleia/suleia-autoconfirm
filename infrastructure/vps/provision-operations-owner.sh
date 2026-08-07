#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
OWNER_FILE="${1:-}"

test -r "${ENV_FILE}"
test -r "${OWNER_FILE}"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
# shellcheck disable=SC1090
source "${OWNER_FILE}"
set +a
: "${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET:?temporary configuration service secret is required}"
: "${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID:?temporary configuration service client id is required}"
: "${OPERATIONS_CENTER_USERNAME:?Operations Center username is required}"
: "${OPERATIONS_CENTER_PASSWORD:?Operations Center password is required}"
[[ "${OPERATIONS_CENTER_USERNAME}" =~ ^[a-zA-Z0-9._-]{3,64}$ ]]
(( ${#OPERATIONS_CENTER_PASSWORD} >= 16 ))

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY \
  --env OPERATIONS_CENTER_USERNAME="${OPERATIONS_CENTER_USERNAME}" \
  --env OPERATIONS_CENTER_PASSWORD="${OPERATIONS_CENTER_PASSWORD}" \
  --env KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET="${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET}" \
  --env KEYCLOAK_CONFIG_SERVICE_CLIENT_ID="${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID}" \
  keycloak sh -s <<'SCRIPT'
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh
SERVER=http://127.0.0.1:8080/auth
KCADM_CONFIG=/tmp/suleia-kcadm-owner.config
trap 'rm -f "${KCADM_CONFIG}"' EXIT
"${KCADM}" config credentials --config "${KCADM_CONFIG}" --server "${SERVER}" --realm master \
  --client "${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID}" --secret "${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET}" >/dev/null

user_id=$("${KCADM}" get users --config "${KCADM_CONFIG}" -r suleia \
  -q "username=${OPERATIONS_CENTER_USERNAME}" -q exact=true --fields id --format csv --noquotes | head -n 1)
if [ -z "${user_id}" ]; then
  user_id=$("${KCADM}" create users --config "${KCADM_CONFIG}" -r suleia -i \
    -s "username=${OPERATIONS_CENTER_USERNAME}" -s enabled=true -s emailVerified=false)
else
  "${KCADM}" update "users/${user_id}" --config "${KCADM_CONFIG}" -r suleia -s enabled=true >/dev/null
fi
"${KCADM}" set-password --config "${KCADM_CONFIG}" -r suleia --userid "${user_id}" \
  --new-password "${OPERATIONS_CENTER_PASSWORD}" --temporary=false >/dev/null
"${KCADM}" add-roles --config "${KCADM_CONFIG}" -r suleia --uid "${user_id}" \
  --rolename operations_reader >/dev/null
"${KCADM}" create "users/${user_id}/logout" --config "${KCADM_CONFIG}" -r suleia >/dev/null 2>&1 || true
SCRIPT

echo "Operations Center owner account provisioned without credential disclosure."
