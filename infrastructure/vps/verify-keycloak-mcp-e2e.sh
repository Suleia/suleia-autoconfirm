#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
VERIFY_SCRIPT="${SULEIA_MCP_E2E_VERIFY_SCRIPT:-${INSTALL_ROOT}/infrastructure/identity/verify-keycloak-mcp-e2e.mjs}"

cleanup() {
  if [[ -n "${TEST_CONTAINER:-}" ]]; then
    docker rm --force "${TEST_CONTAINER}" >/dev/null 2>&1 || true
  fi
  bash "${INSTALL_ROOT}/infrastructure/vps/cleanup-keycloak-config-service.sh"
}
trap cleanup EXIT

bash "${INSTALL_ROOT}/infrastructure/vps/provision-keycloak-config-service-secret.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/bootstrap-keycloak-config-service.sh"
bash "${INSTALL_ROOT}/infrastructure/vps/provision-operations-keycloak.sh"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
: "${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET:?configuration service secret is required}"
: "${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID:?configuration service client id is required}"

MCP_CONTAINER_ID="$(docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" ps -q mcp-server)"
MCP_EDGE_CONTAINER_ID="$(docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" ps -q mcp-edge)"
MCP_IMAGE="$(docker inspect --format '{{.Config.Image}}' "${MCP_CONTAINER_ID}")"
APPLICATION_NETWORK="$(docker inspect --format '{{range $name, $config := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
  "${MCP_CONTAINER_ID}" | grep '_application_network$' | head -n 1)"
IDENTITY_NETWORK="$(docker inspect --format '{{range $name, $config := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
  "${MCP_CONTAINER_ID}" | grep '_identity_network$' | head -n 1)"
[[ "${MCP_IMAGE}" =~ ^[A-Za-z0-9._:/@-]+$ ]]
[[ "${APPLICATION_NETWORK}" =~ ^[A-Za-z0-9_.-]+_application_network$ ]]
[[ "${IDENTITY_NETWORK}" =~ ^[A-Za-z0-9_.-]+_identity_network$ ]]
MCP_EDGE_IP="$(docker inspect --format '{{range $name, $config := .NetworkSettings.Networks}}{{println $name $config.IPAddress}}{{end}}' \
  "${MCP_EDGE_CONTAINER_ID}" | awk -v target="${APPLICATION_NETWORK}" '$1 == target { print $2 }')"
[[ "${MCP_EDGE_IP}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]
TEST_CONTAINER="suleia-mcp-e2e-$(openssl rand -hex 8)"

docker create --name "${TEST_CONTAINER}" --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 256m --cpus 1.0 \
  --network "${APPLICATION_NETWORK}" \
  --add-host "mcp.suleia.com:${MCP_EDGE_IP}" \
  --env KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET="${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET}" \
  --env KEYCLOAK_CONFIG_SERVICE_CLIENT_ID="${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID}" \
  --env MCP_E2E_URL=https://mcp.suleia.com/mcp \
  --volume "${VERIFY_SCRIPT}:/tmp/verify-keycloak-mcp-e2e.mjs:ro" \
  --entrypoint node "${MCP_IMAGE}" \
  /tmp/verify-keycloak-mcp-e2e.mjs >/dev/null
docker network connect "${IDENTITY_NETWORK}" "${TEST_CONTAINER}"
docker start --attach "${TEST_CONTAINER}"
docker rm "${TEST_CONTAINER}" >/dev/null
TEST_CONTAINER=""
