#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${CRON_SECRET:?missing CRON_SECRET}"
exec 9>/var/lib/suleia-incidents/cycle.lock
flock --nonblock 9 || exit 0
response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
curl_exit=0
# No transport retries: a timeout is not proof the server did not execute.
# Render coalesces overlapping sync requests and all writes use durable claims.
http_status="$(curl --silent --show-error --connect-timeout 15 --max-time 1200 \
 --request POST --header "Authorization: Bearer ${CRON_SECRET}" \
 --header 'Accept: application/json' --output "${response_file}" \
 --write-out '%{http_code}' \
 'https://suleia-autoconfirm.onrender.com/api/cron/sync-incidents')" || curl_exit=$?
python3 /usr/local/lib/suleia/validate-incidents-cycle-response.py \
 "${response_file}" "${http_status}" "${curl_exit}" "${started_at}"
