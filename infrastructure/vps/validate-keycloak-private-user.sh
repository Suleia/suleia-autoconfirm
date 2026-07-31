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
SELECT 'human_users=' || count(*)
FROM user_entity u
JOIN realm r ON r.id = u.realm_id
WHERE r.name = 'suleia'
  AND u.service_account_client_link IS NULL;

SELECT 'reader_users=' || count(DISTINCT urm.user_id)
FROM user_role_mapping urm
JOIN user_entity u ON u.id = urm.user_id
JOIN realm r ON r.id = u.realm_id
JOIN keycloak_role kr ON kr.id = urm.role_id
WHERE r.name = 'suleia'
  AND kr.name = 'mcp_reader'
  AND kr.client_role = false;

SELECT 'registration_closed=' || count(*)
FROM realm
WHERE name = 'suleia'
  AND registration_allowed = false;
SQL
)"

printf '%s\n' "${query_result}"
grep -Fxq 'human_users=1' <<<"${query_result}"
grep -Fxq 'reader_users=1' <<<"${query_result}"
grep -Fxq 'registration_closed=1' <<<"${query_result}"

echo "Exactly one private Suleia user has the MCP reader role."
