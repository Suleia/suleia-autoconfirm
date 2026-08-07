#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
OWNER_FILE="${1:-}"
test -r "${OWNER_FILE}"

cleanup() {
  rm -f -- "${OWNER_FILE}"
  bash "${INSTALL_ROOT}/infrastructure/vps/cleanup-keycloak-config-service.sh"
}
trap cleanup EXIT

bash "${INSTALL_ROOT}/infrastructure/vps/provision-keycloak-config-service-secret.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/bootstrap-keycloak-config-service.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/provision-operations-keycloak.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/provision-operations-owner.sh" "${OWNER_FILE}"
