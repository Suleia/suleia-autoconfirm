#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
ENV_FILE="${INSTALL_ROOT}/.env"
SECRET_NAME="KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET"
CLIENT_ID_NAME="KEYCLOAK_CONFIG_SERVICE_CLIENT_ID"

has_secret=false; has_client_id=false
grep -q "^${SECRET_NAME}=" "${ENV_FILE}" && has_secret=true
grep -q "^${CLIENT_ID_NAME}=" "${ENV_FILE}" && has_client_id=true
if [[ "${has_secret}" = "true" && "${has_client_id}" = "true" ]]; then
  echo "Keycloak configuration service secret is already provisioned."
  exit 0
fi
if [[ "${has_secret}" != "${has_client_id}" ]]; then
  echo "Partial Keycloak configuration service state detected." >&2
  exit 1
fi

umask 077
secret_value="$(openssl rand -hex 32)"
client_id_value="suleia-config-service-$(openssl rand -hex 8)"
printf '\n%s=%s\n%s=%s\n' "${SECRET_NAME}" "${secret_value}" \
  "${CLIENT_ID_NAME}" "${client_id_value}" >>"${ENV_FILE}"
unset secret_value
unset client_id_value
chmod 600 "${ENV_FILE}"

echo "Keycloak configuration service secret was provisioned without disclosure."
