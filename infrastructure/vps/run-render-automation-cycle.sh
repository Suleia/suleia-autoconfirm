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

# A timeout does not prove the server skipped the write. Never replay this POST.
if ! http_status="$(curl --silent --show-error \
  --connect-timeout 15 --max-time 600 \
  --request POST \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  --header 'Accept: application/json' \
  --output "${response_file}" \
  --write-out '%{http_code}' \
  "${RENDER_AUTOMATION_URL}")"; then
  echo 'SULEIA_RENDER_AUTOMATION|FAIL|reason=transport_uncertain|automatic_replay=0'
  exit 1
fi

if [[ "${http_status}" != '200' ]]; then
  echo 'SULEIA_RENDER_AUTOMATION|FAIL|reason=http_error|automatic_replay=0'
  exit 1
fi
python3 "${SULEIA_RENDER_CYCLE_VALIDATOR:-/usr/local/libexec/suleia-render-cycle-response.py}" "${response_file}"
