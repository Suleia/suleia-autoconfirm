#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE="${SULEIA_RENDER_AUTOMATION_ENV:-/etc/suleia/render-automation.env}"
LOCK_FILE="${SULEIA_RENDER_AUTOMATION_LOCK:-/run/lock/suleia-render-automation.lock}"
EXPECTED_URL="https://suleia-autoconfirm.onrender.com/api/cron/automation-cycle"

test -r "${ENV_FILE}"
# shellcheck disable=SC1090
source "${ENV_FILE}"
: "${RENDER_AUTOMATION_URL:?missing RENDER_AUTOMATION_URL}"
: "${CRON_SECRET:?missing CRON_SECRET}"
[[ "${RENDER_AUTOMATION_URL}" = "${EXPECTED_URL}" ]]

exec 9>"${LOCK_FILE}"
if ! flock --nonblock 9; then
  echo 'SULEIA_RENDER_AUTOMATION|SKIP|reason=cycle_already_running'
  exit 0
fi

response_file="$(mktemp)"
cleanup() { rm -f "${response_file}"; }
trap cleanup EXIT

http_status="$(curl --silent --show-error \
  --connect-timeout 15 --max-time 240 \
  --retry 2 --retry-delay 5 --retry-all-errors \
  --request POST \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  --header 'Accept: application/json' \
  --output "${response_file}" \
  --write-out '%{http_code}' \
  "${RENDER_AUTOMATION_URL}")"

[[ "${http_status}" = '200' ]]
grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "${response_file}"
echo 'SULEIA_RENDER_AUTOMATION|PASS|http=200|rules=existing|secret_disclosed=0'
