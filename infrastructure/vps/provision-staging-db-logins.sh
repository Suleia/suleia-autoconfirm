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

if [[ -z "${SULEIA_BACKUP_PASSWORD:-}" ]]; then
  echo "SULEIA_BACKUP_PASSWORD is required." >&2
  exit 1
fi
if [[ -z "${SULEIA_KEYCLOAK_DB_PASSWORD:-}" ]]; then
  echo "SULEIA_KEYCLOAK_DB_PASSWORD is required." >&2
  exit 1
fi

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY postgres \
  psql \
  --no-psqlrc \
  --set ON_ERROR_STOP=1 \
  --set "backup_password=${SULEIA_BACKUP_PASSWORD}" \
  --set "keycloak_password=${SULEIA_KEYCLOAK_DB_PASSWORD}" \
  --username suleia_admin \
  --dbname postgres <<'SQL'
SELECT format(
  'CREATE ROLE suleia_backup_login LOGIN PASSWORD %L',
  :'backup_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'suleia_backup_login'
)
\gexec

ALTER ROLE suleia_backup_login PASSWORD :'backup_password';
GRANT suleia_backup TO suleia_backup_login;

SELECT format(
  'CREATE ROLE suleia_keycloak LOGIN PASSWORD %L',
  :'keycloak_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'suleia_keycloak'
)
\gexec

ALTER ROLE suleia_keycloak PASSWORD :'keycloak_password';

SELECT 'CREATE DATABASE suleia_identity OWNER suleia_keycloak'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'suleia_identity'
)
\gexec

REVOKE ALL ON DATABASE suleia_identity FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE suleia_identity TO suleia_keycloak;
SQL

echo "Staging database login roles provisioned."
