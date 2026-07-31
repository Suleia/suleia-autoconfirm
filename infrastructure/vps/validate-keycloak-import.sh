#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

query_result="$(
  docker compose \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    exec --no-TTY postgres \
    psql \
    --username suleia_admin \
    --dbname suleia_identity \
    --tuples-only \
    --no-align <<'SQL'
SELECT 'client=' || count(*) FROM client WHERE client_id = 'chatgpt-suleia-mcp';
SELECT 'reader_role=' || count(*) FROM keycloak_role WHERE name = 'mcp_reader' AND client_role = false;
SELECT 'role_mapper=' || count(*) FROM protocol_mapper WHERE name = 'suleia-realm-roles';
SELECT 'audience_mapper=' || count(*) FROM protocol_mapper WHERE name = 'suleia-mcp-audience';
SELECT 'custom_scopes=' || count(*) FROM client_scope
WHERE name IN ('orders:read', 'timelines:read', 'decisions:read', 'reviews:read', 'orders:simulate');
SELECT 'offline_access_optional=' || count(*)
FROM client_scope_client csc
JOIN client c ON c.id = csc.client_id
JOIN client_scope cs ON cs.id = csc.scope_id
WHERE c.client_id = 'chatgpt-suleia-mcp'
  AND cs.name = 'offline_access'
  AND csc.default_scope = false;
SQL
)"

printf '%s\n' "${query_result}"
grep -Fxq 'client=1' <<<"${query_result}"
grep -Fxq 'reader_role=1' <<<"${query_result}"
grep -Fxq 'role_mapper=1' <<<"${query_result}"
grep -Fxq 'audience_mapper=1' <<<"${query_result}"
grep -Fxq 'custom_scopes=5' <<<"${query_result}"
grep -Fxq 'offline_access_optional=1' <<<"${query_result}"

echo "Keycloak MCP import is complete and internally consistent."
