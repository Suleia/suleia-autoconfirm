#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
ARCHIVE="/tmp/suleia-h-shadow-deploy.tar"
PREVIOUS_ARCHIVE="/tmp/suleia-pre-h-deploy.tar"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
EXPECTED_SHA256="${SULEIA_DEPLOY_ARCHIVE_SHA256:-}"

if [[ "${CONFIRM_SHADOW_DEPLOY:-no}" != "yes" ]]; then
  echo "Checkpoint H deploy blocked: explicit shadow confirmation is required." >&2
  exit 1
fi
if [[ ! "${EXPECTED_SHA256}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "A lowercase SHA-256 is required." >&2
  exit 1
fi
test -r "${ARCHIVE}"
test -r "${ENV_FILE}"
actual_sha256="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
if [[ "${actual_sha256}" != "${EXPECTED_SHA256}" ]]; then
  echo "Deployment archive checksum mismatch." >&2
  exit 1
fi

compose() {
  docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"
}

restore_previous_code() {
  if [[ -r "${PREVIOUS_ARCHIVE}" ]]; then
    tar --extract --file "${PREVIOUS_ARCHIVE}" --directory "${INSTALL_ROOT}"
    compose up --detach --build --wait --wait-timeout 300 >/dev/null || true
  fi
}
trap 'restore_previous_code' ERR

cd "${INSTALL_ROOT}"
umask 077
tar --create --file "${PREVIOUS_ARCHIVE}" --exclude=.env --exclude=.git .

compose --profile maintenance run --rm --no-TTY backup </dev/null
latest="$(compose --profile maintenance run --rm --no-TTY --entrypoint /bin/sh backup \
  -c 'find /backups -maxdepth 1 -type f -name "suleia-*.dump" | sort | tail -n 1')"
if [[ ! "${latest}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]; then
  echo "A valid backup was not created." >&2
  exit 1
fi
compose --profile maintenance run --rm --no-TTY --entrypoint /bin/sh backup \
  -c "/bin/sh /opt/suleia/backup/verify_backup.sh '${latest}'" </dev/null >/dev/null
bash "${INSTALL_ROOT}/infrastructure/vps/run-restore-drill.sh" "${latest}" >/dev/null

tar --extract --file "${ARCHIVE}" --directory "${INSTALL_ROOT}"
bash "${INSTALL_ROOT}/infrastructure/vps/run-operations-center-rollback-drill.sh" "${latest}"
bash "${INSTALL_ROOT}/infrastructure/vps/deploy-private-staging.sh"

trap - ERR
rm -f "${ARCHIVE}"
echo "CHECKPOINT_H_DEPLOY|PASS|backup=verified|restore=verified|rollback=verified|actions=0|production_writes=0"
