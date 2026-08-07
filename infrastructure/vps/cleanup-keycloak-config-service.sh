#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
SECRET_NAME="KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET"
ADMIN_SECRET_NAME="KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD"
CLIENT_ID_NAME="KEYCLOAK_CONFIG_SERVICE_CLIENT_ID"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
CONFIG_SERVICE_CLIENT_ID="${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID:-suleia-config-service}"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY --env KEYCLOAK_CONFIG_SERVICE_CLIENT_ID="${CONFIG_SERVICE_CLIENT_ID}" \
  keycloak sh -s <<'INNER' || true
set -u
KCADM=/opt/keycloak/bin/kcadm.sh
KCADM_CONFIG=/tmp/suleia-kcadm.config
for target_client_id in "${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID}" suleia-config-service; do
  config_client_uuid="$(
    "${KCADM}" get clients --config "${KCADM_CONFIG}" --realm master \
      --query "clientId=${target_client_id}" --fields id --format csv --noquotes 2>/dev/null \
    | head -n 1
  )"
  if [ -n "${config_client_uuid}" ]; then
    "${KCADM}" delete "clients/${config_client_uuid}" --config "${KCADM_CONFIG}" \
      --realm master >/dev/null
  fi
done
rm -f "${KCADM_CONFIG}" /opt/keycloak/.keycloak/kcadm.config
INNER

temporary_env="$(mktemp "${INSTALL_ROOT}/.env.cleanup.XXXXXX")"
grep -v -e "^${SECRET_NAME}=" -e "^${ADMIN_SECRET_NAME}=" -e "^${CLIENT_ID_NAME}=" \
  "${ENV_FILE}" >"${temporary_env}"
chmod 600 "${temporary_env}"
mv -f "${temporary_env}" "${ENV_FILE}"

echo "Keycloak temporary configuration service and local secret were removed."
