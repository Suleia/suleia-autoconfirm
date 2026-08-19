#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
OUTPUT_DIR="${SULEIA_RUNTIME_OUTPUT_DIR:-${INSTALL_ROOT}/private-runtime}"
OUTPUT_FILE="${OUTPUT_DIR}/platform-runtime.json"
COLLECTOR_SOURCE="${SULEIA_RUNTIME_COLLECTOR_SOURCE:-${INSTALL_ROOT}/infrastructure/scripts/collect-platform-runtime-inventory.mjs}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
PS_SNAPSHOT="${OUTPUT_DIR}/compose-ps.json"
STATS_SNAPSHOT="${OUTPUT_DIR}/docker-stats.json"

install -d -m 0755 "${OUTPUT_DIR}"
umask 077

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" \
  ps --format json > "${PS_SNAPSHOT}.tmp"
mv "${PS_SNAPSHOT}.tmp" "${PS_SNAPSHOT}"
docker stats --no-stream --format '{{json .}}' > "${STATS_SNAPSHOT}.tmp"
mv "${STATS_SNAPSHOT}.tmp" "${STATS_SNAPSHOT}"

git_commit="${SULEIA_RUNTIME_GIT_COMMIT:-$(git -C "${INSTALL_ROOT}" rev-parse HEAD 2>/dev/null || true)}"
git_branch="${SULEIA_RUNTIME_GIT_BRANCH:-$(git -C "${INSTALL_ROOT}" branch --show-current 2>/dev/null || true)}"
backup_status="UNKNOWN"
if docker volume ls --filter name=backup_data --format '{{.Name}}' | grep -q .; then
  backup_status="VOLUME_PRESENT_NOT_REVERIFIED"
fi

docker run --rm --user "$(id -u):$(id -g)" --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 256m --cpus 1.0 \
  --volume "${INSTALL_ROOT}/apps:/workspace/apps:ro" \
  --volume "${INSTALL_ROOT}/docs:/workspace/docs:ro" \
  --volume "${INSTALL_ROOT}/infrastructure:/workspace/infrastructure:ro" \
  --volume "${COLLECTOR_SOURCE}:/workspace/infrastructure/scripts/collect-platform-runtime-inventory.mjs:ro" \
  --volume "${INSTALL_ROOT}/migrations:/workspace/migrations:ro" \
  --volume "${INSTALL_ROOT}/packages:/workspace/packages:ro" \
  --volume "${INSTALL_ROOT}/services:/workspace/services:ro" \
  --volume "${OUTPUT_DIR}:/workspace/private-runtime:rw" \
  --env "SULEIA_RUNTIME_GIT_COMMIT=${git_commit}" \
  --env "SULEIA_RUNTIME_GIT_BRANCH=${git_branch}" \
  --env "SULEIA_RUNTIME_BACKUP_STATUS=${backup_status}" \
  node:22.22.0-alpine node /workspace/infrastructure/scripts/collect-platform-runtime-inventory.mjs \
  /workspace /workspace/private-runtime/platform-runtime.json

chmod 0644 "${OUTPUT_FILE}"
rm -f "${PS_SNAPSHOT}" "${STATS_SNAPSHOT}"
echo 'PLATFORM_RUNTIME_INVENTORY|PASS|secret_fields=0|actions=0|production_writes=0'
