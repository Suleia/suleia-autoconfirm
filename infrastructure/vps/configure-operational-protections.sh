#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_ROOT="${SULEIA_BACKUP_ROOT:-/backups}"

test -r "${ENV_FILE}"
IFS= read -r protected_phone
protected_phone="${protected_phone%$'\r'}"
if [[ ! "${protected_phone}" =~ ^\+34[0-9]{9}$ ]]; then
  echo 'PHONE_CONFIGURATION=REJECTED' >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${BACKUP_ROOT}/suleia-env-before-protections-${stamp}"
cp "${ENV_FILE}" "${backup_file}"
chmod 600 "${backup_file}"

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

set_env TEST_PHONE_NORMALIZED "${protected_phone}"
set_env TEST_PHONE_BLOCK_ENABLED true
set_env DUPLICATE_ORDER_DETECTION_ENABLED true
set_env DUPLICATE_ORDER_BLOCKING_ENABLED false
set_env CHATBY_CONTACT_CLEANUP_PREVIEW_ENABLED true
set_env CHATBY_CONTACT_DELETE_ENABLED false
set_env RELEASIT_RETURN_BLOCK_PREVIEW_ENABLED true
set_env RELEASIT_RETURN_BLOCK_WRITE_ENABLED false
chmod 600 "${ENV_FILE}"
unset protected_phone

echo 'PHONE_CONFIGURATION=PRESENT'
echo 'PROTECTION_FLAGS=SAFE_PREVIEW'
