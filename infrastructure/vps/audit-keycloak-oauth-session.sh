#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY postgres \
  psql \
  --username suleia_admin \
  --dbname suleia_identity \
  --tuples-only \
  --no-align <<'SQL'
SELECT 'offline_user_sessions=' || count(*) FROM offline_user_session;
SELECT 'offline_client_sessions=' || count(*) FROM offline_client_session;
SELECT 'user_consents=' || count(*)
FROM user_consent uc
JOIN user_entity u ON u.id = uc.user_id
JOIN realm r ON r.id = u.realm_id
WHERE r.name = 'suleia';
SQL
