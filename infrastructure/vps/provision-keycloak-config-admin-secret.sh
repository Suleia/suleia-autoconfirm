#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
ENV_FILE="${INSTALL_ROOT}/.env"
SECRET_NAME="KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD"

if grep -q "^${SECRET_NAME}=" "${ENV_FILE}"; then
  echo "Keycloak configuration administrator secret is already provisioned."
  exit 0
fi

umask 077
secret_value="$(openssl rand -hex 32)"
printf '\n%s=%s\n' "${SECRET_NAME}" "${secret_value}" >>"${ENV_FILE}"
unset secret_value
chmod 600 "${ENV_FILE}"

echo "Keycloak configuration administrator secret was provisioned without disclosure."
