#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "Staging environment file is missing." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
: "${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET:?temporary configuration service secret is required}"
: "${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID:?temporary configuration service client id is required}"

ready=false
for _ in $(seq 1 45); do
  if docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY api \
    wget -qO- http://keycloak:9000/auth/health/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "${ready}" != "true" ]]; then
  echo "Keycloak did not become ready for Operations Center provisioning." >&2
  exit 1
fi

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY \
  --env KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET="${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET}" \
  --env KEYCLOAK_CONFIG_SERVICE_CLIENT_ID="${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID}" \
  keycloak sh -s <<'SCRIPT'
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh
SERVER=http://127.0.0.1:8080/auth
KCADM_CONFIG=/tmp/suleia-kcadm.config
csv_id_by_name() {
  target="$1"
  while IFS=, read -r item_id item_name; do
    if [ "${item_name}" = "${target}" ]; then
      printf '%s' "${item_id}"
      return 0
    fi
  done
}
first_line() {
  IFS= read -r value || true
  printf '%s' "${value:-}"
}
contains_line() {
  target="$1"
  while IFS= read -r value; do
    [ "${value}" = "${target}" ] && return 0
  done
  return 1
}
"${KCADM}" config credentials --config "${KCADM_CONFIG}" --server "${SERVER}" --realm master \
  --client "${KEYCLOAK_CONFIG_SERVICE_CLIENT_ID}" --secret "${KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET}" >/dev/null

if ! "${KCADM}" get roles/operations_reader --config "${KCADM_CONFIG}" -r suleia >/dev/null 2>&1; then
  "${KCADM}" create roles --config "${KCADM_CONFIG}" -r suleia -s name=operations_reader \
    -s 'description=Allows authenticated read-only access to Suleia Operations Center' >/dev/null
fi

scope_id=$("${KCADM}" get client-scopes --config "${KCADM_CONFIG}" -r suleia --fields id,name --format csv --noquotes \
  | csv_id_by_name 'operations:read')
if [ -z "${scope_id}" ]; then
  scope_id=$("${KCADM}" create client-scopes --config "${KCADM_CONFIG}" -r suleia -i -s name=operations:read \
    -s protocol=openid-connect -s 'attributes."include.in.token.scope"=true')
fi

client_id=$("${KCADM}" get clients --config "${KCADM_CONFIG}" -r suleia -q clientId=suleia-operations-center \
  --fields id --format csv --noquotes | first_line)
if [ -z "${client_id}" ]; then
  client_id=$("${KCADM}" create clients --config "${KCADM_CONFIG}" -r suleia -i \
    -s clientId=suleia-operations-center -s 'name=Suleia Operations Center' \
    -s enabled=true -s publicClient=true -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false -s serviceAccountsEnabled=false \
    -s fullScopeAllowed=false -s consentRequired=false \
    -s 'redirectUris=["https://mcp.suleia.com/operations/*","https://ops.suleia.com/*","https://ops-staging.localhost/*"]' \
    -s 'webOrigins=["https://mcp.suleia.com","https://ops.suleia.com","https://ops-staging.localhost"]' \
    -s 'attributes."pkce.code.challenge.method"=S256' \
    -s 'attributes."post.logout.redirect.uris"=https://mcp.suleia.com/operations/*##https://ops.suleia.com/*##https://ops-staging.localhost/*')
else
  "${KCADM}" update "clients/${client_id}" --config "${KCADM_CONFIG}" -r suleia \
    -s enabled=true -s publicClient=true -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false -s serviceAccountsEnabled=false \
    -s fullScopeAllowed=false -s consentRequired=false \
    -s 'redirectUris=["https://mcp.suleia.com/operations/*","https://ops.suleia.com/*","https://ops-staging.localhost/*"]' \
    -s 'webOrigins=["https://mcp.suleia.com","https://ops.suleia.com","https://ops-staging.localhost"]' \
    -s 'attributes."pkce.code.challenge.method"=S256' \
    -s 'attributes."post.logout.redirect.uris"=https://mcp.suleia.com/operations/*##https://ops.suleia.com/*##https://ops-staging.localhost/*' >/dev/null
fi

"${KCADM}" update "clients/${client_id}/default-client-scopes/${scope_id}" --config "${KCADM_CONFIG}" -r suleia -n >/dev/null 2>&1 || true

profile_scope_id=$("${KCADM}" get client-scopes --config "${KCADM_CONFIG}" -r suleia --fields id,name --format csv --noquotes \
  | csv_id_by_name profile)
if [ -n "${profile_scope_id}" ]; then
  "${KCADM}" update "clients/${client_id}/optional-client-scopes/${profile_scope_id}" \
    --config "${KCADM_CONFIG}" -r suleia -n >/dev/null 2>&1 || true
fi

mapper_id=$("${KCADM}" get "clients/${client_id}/protocol-mappers/models" --config "${KCADM_CONFIG}" -r suleia \
  --fields id,name --format csv --noquotes | csv_id_by_name 'operations-audience')
if [ -z "${mapper_id}" ]; then
  "${KCADM}" create "clients/${client_id}/protocol-mappers/models" --config "${KCADM_CONFIG}" -r suleia \
    -s name=operations-audience -s protocol=openid-connect \
    -s protocolMapper=oidc-audience-mapper -s consentRequired=false \
    -s 'config."included.client.audience"=suleia-operations-center' \
    -s 'config."id.token.claim"=false' -s 'config."access.token.claim"=true' >/dev/null
fi

"${KCADM}" get users --config "${KCADM_CONFIG}" -r suleia --fields id --format csv --noquotes | while IFS= read -r user_id; do
  [ -n "${user_id}" ] || continue
  if "${KCADM}" get "users/${user_id}/role-mappings/realm/composite" --config "${KCADM_CONFIG}" -r suleia \
    --fields name --format csv --noquotes | contains_line mcp_reader; then
    "${KCADM}" add-roles --config "${KCADM_CONFIG}" -r suleia --uid "${user_id}" --rolename operations_reader >/dev/null
  fi
done
SCRIPT

echo "Operations Center OAuth client and role provisioned."
