#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"

cleanup() {
  bash "${INSTALL_ROOT}/infrastructure/vps/cleanup-keycloak-config-service.sh"
}
trap cleanup EXIT

bash "${INSTALL_ROOT}/infrastructure/vps/provision-keycloak-config-service-secret.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/bootstrap-keycloak-config-service.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/configure-keycloak-chatgpt-dcr.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/validate-keycloak-chatgpt-dcr.sh"
