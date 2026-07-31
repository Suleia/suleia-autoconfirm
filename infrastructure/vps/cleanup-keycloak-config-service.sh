#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
SECRET_NAME="KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY keycloak sh -s <<'INNER' || true
set -u
KCADM=/opt/keycloak/bin/kcadm.sh
KCADM_CONFIG=/tmp/suleia-kcadm.config
config_client_uuid="$(
  "${KCADM}" get clients \
    --config "${KCADM_CONFIG}" \
    --realm master \
    --query clientId=suleia-config-service \
    --fields id \
    --format csv \
    --noquotes 2>/dev/null \
  | head -n 1
)"
if [ -n "${config_client_uuid}" ]; then
  "${KCADM}" delete "clients/${config_client_uuid}" \
    --config "${KCADM_CONFIG}" \
    --realm master >/dev/null
fi
rm -f "${KCADM_CONFIG}" /opt/keycloak/.keycloak/kcadm.config
INNER

temporary_env="$(mktemp "${INSTALL_ROOT}/.env.cleanup.XXXXXX")"
grep -v "^${SECRET_NAME}=" "${ENV_FILE}" >"${temporary_env}"
chmod 600 "${temporary_env}"
mv -f "${temporary_env}" "${ENV_FILE}"

echo "Keycloak temporary configuration service and local secret were removed."
