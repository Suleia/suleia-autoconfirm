#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
OUTPUT_DIR="${INSTALL_ROOT}/private-runtime"
OUTPUT_FILE="${OUTPUT_DIR}/platform-runtime.json"

install -d -m 0750 "${OUTPUT_DIR}"
node "${INSTALL_ROOT}/infrastructure/scripts/collect-platform-runtime-inventory.mjs" \
  "${INSTALL_ROOT}" "${OUTPUT_FILE}"
chmod 0640 "${OUTPUT_FILE}"
echo 'PLATFORM_RUNTIME_INVENTORY|PASS|secret_fields=0|actions=0|production_writes=0'
