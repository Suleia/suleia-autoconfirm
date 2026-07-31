#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY \
  --env KC_CLI_PASSWORD="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD}" \
  keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://127.0.0.1:8080/auth \
  --realm master \
  --user suleia-config-admin >/dev/null

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY keycloak sh -s <<'INNER'
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh

components="$("${KCADM}" get components \
  --realm suleia \
  --fields id,name,providerId,subType \
  --format csv \
  --noquotes)"

trusted_id="$(
  printf '%s\n' "${components}" \
  | awk -F, '$2 == "Trusted Hosts" && $3 == "trusted-hosts" && $4 == "anonymous" { print $1 }'
)"
test -n "${trusted_id}"

"${KCADM}" update "components/${trusted_id}" \
  --realm suleia \
  --set 'config={"trusted-hosts":["20.170.184.32","20.170.184.33","chatgpt.com","*.chatgpt.com"],"host-sending-registration-request-must-match":["true"],"client-uris-must-match":["true"]}' >/dev/null

max_clients_id="$(
  printf '%s\n' "${components}" \
  | awk -F, '$2 == "Max Clients Limit" && $3 == "max-clients" && $4 == "anonymous" { print $1 }'
)"
test -n "${max_clients_id}"

"${KCADM}" update "components/${max_clients_id}" \
  --realm suleia \
  --set 'config={"max-clients":["20"]}' >/dev/null

echo "ChatGPT dynamic registration policy is configured."
INNER
