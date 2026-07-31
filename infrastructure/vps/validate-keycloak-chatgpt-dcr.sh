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
SELECT 'trusted_chatgpt=' || count(*)
FROM component_config cc
JOIN component c ON c.id = cc.component_id
JOIN realm r ON r.id = c.realm_id
WHERE r.name = 'suleia'
  AND c.provider_id = 'trusted-hosts'
  AND c.sub_type = 'anonymous'
  AND cc.name = 'trusted-hosts'
  AND cc.value IN ('chatgpt.com', '*.chatgpt.com');

SELECT 'source_host_check_disabled=' || count(*)
FROM component_config cc
JOIN component c ON c.id = cc.component_id
JOIN realm r ON r.id = c.realm_id
WHERE r.name = 'suleia'
  AND c.provider_id = 'trusted-hosts'
  AND c.sub_type = 'anonymous'
  AND cc.name = 'host-sending-registration-request-must-match'
  AND cc.value = 'false';

SELECT 'client_uri_check_enabled=' || count(*)
FROM component_config cc
JOIN component c ON c.id = cc.component_id
JOIN realm r ON r.id = c.realm_id
WHERE r.name = 'suleia'
  AND c.provider_id = 'trusted-hosts'
  AND c.sub_type = 'anonymous'
  AND cc.name = 'client-uris-must-match'
  AND cc.value = 'true';

SELECT 'max_clients_20=' || count(*)
FROM component_config cc
JOIN component c ON c.id = cc.component_id
JOIN realm r ON r.id = c.realm_id
WHERE r.name = 'suleia'
  AND c.provider_id = 'max-clients'
  AND c.sub_type = 'anonymous'
  AND cc.name = 'max-clients'
  AND cc.value = '20';
SQL
)"

printf '%s\n' "${query_result}"
grep -Fxq 'trusted_chatgpt=2' <<<"${query_result}"
grep -Fxq 'source_host_check_disabled=1' <<<"${query_result}"
grep -Fxq 'client_uri_check_enabled=1' <<<"${query_result}"
grep -Fxq 'max_clients_20=1' <<<"${query_result}"

echo "ChatGPT dynamic registration policy is internally consistent."
