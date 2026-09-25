#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/run/lock/suleia-runtime-inventory.lock
flock -n 9 || exit 0
install=/opt/suleia-operations
output="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/private-runtime"}}{{.Source}}{{end}}{{end}}' suleia-operations-staging-mcp-server-1)"
[[ "$output" =~ ^/opt/suleia-releases/[0-9a-f]{40}/private-runtime$ ]] || exit 2
umask 022
docker exec -i suleia-operations-staging-api-1 node --input-type=module < "$install/infrastructure/scripts/collect-absent-runtime-health.mjs" > "$output/functional-health.json.tmp"
jq -e '.components|length==5' "$output/functional-health.json.tmp" >/dev/null
chmod 0644 "$output/functional-health.json.tmp"
mv "$output/functional-health.json.tmp" "$output/functional-health.json"
SULEIA_RUNTIME_OUTPUT_DIR="$output" bash "$install/infrastructure/vps/collect-platform-runtime-inventory.sh"
