#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
EXPECTED_INSTALL_ROOT="/opt/suleia-operations"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_ROOT="/home/suleiaops/suleia-backups"
IDENTITY_DATABASE="suleia_identity"
IDENTITY_OWNER="suleia_keycloak"

if [[ "${INSTALL_ROOT}" != "${EXPECTED_INSTALL_ROOT}" ]]; then
  echo "Refusing identity reset outside ${EXPECTED_INSTALL_ROOT}." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

mkdir -p "${BACKUP_ROOT}"
backup_file="${BACKUP_ROOT}/keycloak-identity-pre-reset-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  stop keycloak

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY postgres \
  pg_dump \
  --username "${POSTGRES_USER}" \
  --format custom \
  --file "/tmp/keycloak-identity-pre-reset.dump" \
  "${IDENTITY_DATABASE}"

postgres_container="$(
  docker compose \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    ps --quiet postgres
)"
docker cp \
  "${postgres_container}:/tmp/keycloak-identity-pre-reset.dump" \
  "${backup_file}"
chmod 600 "${backup_file}"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  exec --no-TTY postgres \
  psql \
  --username "${POSTGRES_USER}" \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "REVOKE CONNECT ON DATABASE ${IDENTITY_DATABASE} FROM public;" \
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${IDENTITY_DATABASE}' AND pid <> pg_backend_pid();" \
  --command "DROP DATABASE ${IDENTITY_DATABASE};" \
  --command "CREATE DATABASE ${IDENTITY_DATABASE} OWNER ${IDENTITY_OWNER};"

docker compose \
  --env-file "${ENV_FILE}" \
  --file "${COMPOSE_FILE}" \
  up --detach keycloak

for attempt in $(seq 1 90); do
  if docker compose \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    exec --no-TTY mcp-edge \
    wget -qO- http://keycloak:9000/auth/health/ready 2>/dev/null \
    | grep -q '"status": "UP"'; then
    echo "Empty Keycloak identity database was rebuilt and imported."
    echo "Restricted host backup created with mode 600: ${backup_file}"
    exit 0
  fi
  sleep 2
done

echo "Keycloak did not become ready after the identity reset." >&2
exit 1
