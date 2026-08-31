#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
ARCHIVE="${SULEIA_SHADOW_ARCHIVE:-/tmp/suleia-c1-shadow-deploy.tar}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"

if [[ "${CONFIRM_SHADOW_DEPLOY:-no}" != "yes" ]]; then
  echo "Shadow deploy blocked: set CONFIRM_SHADOW_DEPLOY=yes." >&2
  exit 1
fi
if [[ "$(readlink -f "${ARCHIVE}")" != "/tmp/suleia-c1-shadow-deploy.tar" ]]; then
  echo "Unexpected deployment archive path." >&2
  exit 1
fi
test -r "${ARCHIVE}"
test -r "${ENV_FILE}"

cd "${INSTALL_ROOT}"
docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" --profile maintenance run --rm --no-TTY backup </dev/null
docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" --profile maintenance run --rm --no-TTY \
  --entrypoint /bin/sh backup -c 'latest=$(find /backups -maxdepth 1 -type f -name "suleia-*.dump" | sort | tail -n 1); test -n "$latest"; /bin/sh /opt/suleia/backup/verify_backup.sh "$latest"' </dev/null

tar --extract --file "${ARCHIVE}" --directory "${INSTALL_ROOT}"
chmod 0755 "${INSTALL_ROOT}/infrastructure/scripts/verify-shadow-state.sh" \
  "${INSTALL_ROOT}/infrastructure/vps/provision-staging-db-logins.sh"

docker run --rm --volume "${INSTALL_ROOT}:/workspace:ro" --workdir /workspace node:22.22.0-alpine \
  node infrastructure/scripts/validate_staging_safety.mjs </dev/null
docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" config --quiet </dev/null
"${INSTALL_ROOT}/infrastructure/vps/provision-staging-db-logins.sh" </dev/null

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin \
  --dbname "${POSTGRES_DB:-suleia_staging}" < "${INSTALL_ROOT}/migrations/005_shadow_operational_replica.sql" >/dev/null

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" up --detach --build --no-deps --wait ingestion-worker </dev/null
rm -f "/tmp/suleia-c1-shadow-deploy.tar"
echo "SHADOW_DEPLOY|PASS|run_mode=SHADOW_READ_ONLY|actions=0|production_writes=0"
