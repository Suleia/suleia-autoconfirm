#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "Staging environment file is missing." >&2
  exit 1
fi

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY keycloak sh -s <<'SCRIPT'
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh
SERVER=http://127.0.0.1:8080/auth
"${KCADM}" config credentials --server "${SERVER}" --realm master \
  --user "${KC_BOOTSTRAP_ADMIN_USERNAME}" --password "${KC_BOOTSTRAP_ADMIN_PASSWORD}" >/dev/null

if ! "${KCADM}" get roles/operations_reader -r suleia >/dev/null 2>&1; then
  "${KCADM}" create roles -r suleia -s name=operations_reader \
    -s 'description=Allows authenticated read-only access to Suleia Operations Center' >/dev/null
fi

scope_id=$("${KCADM}" get client-scopes -r suleia --fields id,name --format csv --noquotes \
  | awk -F, '$2=="operations:read" {print $1; exit}')
if [ -z "${scope_id}" ]; then
  scope_id=$("${KCADM}" create client-scopes -r suleia -i -s name=operations:read \
    -s protocol=openid-connect -s 'attributes."include.in.token.scope"=true')
fi

client_id=$("${KCADM}" get clients -r suleia -q clientId=suleia-operations-center \
  --fields id --format csv --noquotes | head -n 1)
if [ -z "${client_id}" ]; then
  client_id=$("${KCADM}" create clients -r suleia -i \
    -s clientId=suleia-operations-center -s 'name=Suleia Operations Center' \
    -s enabled=true -s publicClient=true -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false -s serviceAccountsEnabled=false \
    -s fullScopeAllowed=false -s consentRequired=false \
    -s 'redirectUris=["https://mcp.suleia.com/operations/*","https://ops.suleia.com/*","https://ops-staging.localhost/*"]' \
    -s 'webOrigins=["https://mcp.suleia.com","https://ops.suleia.com","https://ops-staging.localhost"]' \
    -s 'attributes."pkce.code.challenge.method"=S256' \
    -s 'attributes."post.logout.redirect.uris"=https://mcp.suleia.com/operations/*##https://ops.suleia.com/*##https://ops-staging.localhost/*')
else
  "${KCADM}" update "clients/${client_id}" -r suleia \
    -s enabled=true -s publicClient=true -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false -s serviceAccountsEnabled=false \
    -s fullScopeAllowed=false -s consentRequired=false \
    -s 'redirectUris=["https://mcp.suleia.com/operations/*","https://ops.suleia.com/*","https://ops-staging.localhost/*"]' \
    -s 'webOrigins=["https://mcp.suleia.com","https://ops.suleia.com","https://ops-staging.localhost"]' \
    -s 'attributes."pkce.code.challenge.method"=S256' \
    -s 'attributes."post.logout.redirect.uris"=https://mcp.suleia.com/operations/*##https://ops.suleia.com/*##https://ops-staging.localhost/*' >/dev/null
fi

"${KCADM}" update "clients/${client_id}/default-client-scopes/${scope_id}" -r suleia -n >/dev/null 2>&1 || true

mapper_id=$("${KCADM}" get "clients/${client_id}/protocol-mappers/models" -r suleia \
  --fields id,name --format csv --noquotes | awk -F, '$2=="operations-audience" {print $1; exit}')
if [ -z "${mapper_id}" ]; then
  "${KCADM}" create "clients/${client_id}/protocol-mappers/models" -r suleia \
    -s name=operations-audience -s protocol=openid-connect \
    -s protocolMapper=oidc-audience-mapper -s consentRequired=false \
    -s 'config."included.client.audience"=suleia-operations-center' \
    -s 'config."id.token.claim"=false' -s 'config."access.token.claim"=true' >/dev/null
fi

"${KCADM}" get users -r suleia --fields id --format csv --noquotes | while IFS= read -r user_id; do
  [ -n "${user_id}" ] || continue
  if "${KCADM}" get "users/${user_id}/role-mappings/realm/composite" -r suleia \
    --fields name --format csv --noquotes | grep -qx mcp_reader; then
    "${KCADM}" add-roles -r suleia --uid "${user_id}" --rolename operations_reader >/dev/null
  fi
done
SCRIPT

echo "Operations Center OAuth client and role provisioned."
