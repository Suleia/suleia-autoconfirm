#!/usr/bin/env bash
# Deploy only the dedicated authorization/observer process. No activation.
set -Eeuo pipefail
revision="${1:?exact revision required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
release="/opt/suleia-releases/$revision"
[[ "$(git -C "$release" rev-parse HEAD)" == "$revision" ]] || exit 2
[[ -f /opt/suleia-secrets/absent-native-gate.env ]] || exit 2
[[ "$(docker exec suleia-operations-staging-postgres-1 psql -X -At -U suleia_admin -d suleia_staging -c "SELECT count(*) FROM operations.recipient_absent_native_control WHERE status='DISABLED' AND NOT automation_live AND NOT native_send_enabled AND NOT template_sends_enabled")" == 1 ]] || exit 2
docker image inspect "suleia-absent-resolution:$revision" >/dev/null
# Existing container is never replaced implicitly.
if docker inspect recipient-absent-live-controller >/dev/null 2>&1; then exit 2; fi
docker create --name recipient-absent-live-controller --restart unless-stopped \
 --network suleia-operations-staging_database_network \
 --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 \
 --memory 256m --cpus 0.5 --tmpfs /tmp:rw,noexec,nosuid,size=16m \
 --env-file /opt/suleia-secrets/absent-native-gate.env \
 --health-cmd 'node -e "fetch(\"http://127.0.0.1:3310/health\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"' \
 --health-interval 30s --health-timeout 5s --health-retries 3 \
 --log-opt max-size=5m --log-opt max-file=3 \
 "suleia-absent-resolution:$revision" node services/recipient-absent-native-worker.mjs >/dev/null
docker network connect suleia-operations-staging_application_network recipient-absent-live-controller
docker network connect suleia-operations-staging_public_network recipient-absent-live-controller
docker start recipient-absent-live-controller >/dev/null
echo ABSENT_CONTROLLER_STARTED_DISABLED
