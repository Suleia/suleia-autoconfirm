#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${CRON_SECRET:?missing CRON_SECRET}"
exec 9>/var/lib/suleia-incidents/cycle.lock
flock --nonblock 9 || exit 0
response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT
# No transport retries: a timeout is not proof the server did not execute.
# Render coalesces overlapping sync requests and all writes use durable claims.
http_status="$(curl --silent --show-error --connect-timeout 15 --max-time 1200 \
 --request POST --header "Authorization: Bearer ${CRON_SECRET}" \
 --header 'Accept: application/json' --output "${response_file}" \
 --write-out '%{http_code}' \
 'https://suleia-autoconfirm.onrender.com/api/cron/sync-incidents')"
[[ "${http_status}" = '200' ]]
python3 - "${response_file}" <<'PY'
import json, sys, datetime, pathlib
payload=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert payload.get('ok') is True
r=payload.get('result') or {}
summary={'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'ok':True,'reviewStartedAt':r.get('updatedAt'),'count':r.get('count'),
 'types':{},'activity':r.get('customerActivitySummary'),
 'offersSent':(r.get('discountRecoverySummary') or {}).get('sent'),
 'returnsVerified':(r.get('discountReturnSummary') or {}).get('requestedVerified'),
 'resolutionFailures':(r.get('incidentResolutionSummary') or {}).get('failures')}
for incident in r.get('incidents',[]):
 kind=incident.get('incidentType','unknown')
 summary['types'][kind]=summary['types'].get(kind,0)+1
path=pathlib.Path('/var/lib/suleia-incidents/last-cycle.json')
tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(summary));tmp.replace(path)
print(json.dumps(summary))
PY
