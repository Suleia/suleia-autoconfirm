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
PROVENANCE_SNAPSHOT="${OUTPUT_DIR}/containers-provenance.json"

install -d -m 0755 "${OUTPUT_DIR}"
umask 077

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" \
  ps --format json > "${PS_SNAPSHOT}.tmp"
mv "${PS_SNAPSHOT}.tmp" "${PS_SNAPSHOT}"
docker stats --no-stream --format '{{json .}}' > "${STATS_SNAPSHOT}.tmp"
mv "${STATS_SNAPSHOT}.tmp" "${STATS_SNAPSHOT}"
# Whitelisted provenance only. Never export Config.Env or full inspections.
docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" ps -q \
  | xargs -r docker inspect --format '{{json .}}' \
  | jq -s 'map({service:.Config.Labels["com.docker.compose.service"],container_id:.Id,image_id:.Image,image_revision:.Config.Labels["org.opencontainers.image.revision"],container_revision:((.Config.Env|map(select(startswith("SULEIA_BUILD_REVISION=")))|first)//""|ltrimstr("SULEIA_BUILD_REVISION="))})' > "${PROVENANCE_SNAPSHOT}.tmp"
mv "${PROVENANCE_SNAPSHOT}.tmp" "${PROVENANCE_SNAPSHOT}"

# Dedicated AUSENTE is intentionally outside Compose. Inspect only this exact
# container, never include stopped backups or export credentials.
controller=recipient-absent-live-controller
if docker inspect "$controller" >/dev/null 2>&1; then
  docker inspect "$controller" --format '{"ID":{{json .Id}},"Name":{{json .Name}},"Service":"recipient-absent-live-controller","Image":{{json .Config.Image}},"State":{{json .State.Status}},"Health":{{json .State.Health.Status}}}' | jq -c '.Name|=ltrimstr("/")' >> "$PS_SNAPSHOT"
  docker inspect "$controller" --format '{"service":"recipient-absent-live-controller","container_id":{{json .Id}},"image_id":{{json .Image}},"image_revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"restart_count":{{json .RestartCount}},"restart_policy":{{json .HostConfig.RestartPolicy.Name}}}' > "$OUTPUT_DIR/absent-provenance.tmp"
  jq -s '.[0]+[.[1]]' "$PROVENANCE_SNAPSHOT" "$OUTPUT_DIR/absent-provenance.tmp" > "${PROVENANCE_SNAPSHOT}.tmp"
  mv "${PROVENANCE_SNAPSHOT}.tmp" "$PROVENANCE_SNAPSHOT"
  rm -f "$OUTPUT_DIR/absent-provenance.tmp"
fi

git_commit="${SULEIA_RUNTIME_GIT_COMMIT:-$(git -C "${INSTALL_ROOT}" rev-parse HEAD 2>/dev/null || true)}"
git_branch="${SULEIA_RUNTIME_GIT_BRANCH:-$(git -C "${INSTALL_ROOT}" branch --show-current 2>/dev/null || true)}"
backup_status="UNKNOWN"
if docker volume ls --filter name=backup_data --format '{{.Name}}' | grep -q .; then
  backup_status="VOLUME_PRESENT_NOT_REVERIFIED"
fi

# The mounted directory can belong to the application UID while systemd runs
# this collector as root. With all capabilities dropped, root cannot write a
# different user's 0755 directory. Run with the directory owner instead.
output_owner="$(stat -c '%u:%g' "${OUTPUT_DIR}")"
chown "${output_owner}" "${PS_SNAPSHOT}" "${STATS_SNAPSHOT}" "${PROVENANCE_SNAPSHOT}"
docker run --rm --user "${output_owner}" --network none --read-only --cap-drop ALL \
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
rm -f "${PS_SNAPSHOT}" "${STATS_SNAPSHOT}" "${PROVENANCE_SNAPSHOT}"
echo 'PLATFORM_RUNTIME_INVENTORY|PASS|secret_fields=0|actions=0|production_writes=0'
