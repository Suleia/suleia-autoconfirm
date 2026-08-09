#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
COMPOSE_FILE="${INSTALL_ROOT}/infrastructure/docker/compose.yaml"
ENV_FILE="${INSTALL_ROOT}/.env"
BACKUP_FILE="${1:-}"

[[ "${BACKUP_FILE}" =~ ^/backups/suleia-[0-9TZ]+\.dump$ ]]

compose() {
  docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"
}

compose exec --no-TTY api node -e '
  fetch("http://127.0.0.1:3200/health").then(async (response) => {
    const payload = await response.json();
    if (!response.ok || payload.run_mode !== "SHADOW_READ_ONLY" || payload.actions_executed !== 0 || payload.production_writes !== 0) process.exit(1);
    console.log("API_HEALTH|PASS|actions=0|production_writes=0");
  });'

compose exec --no-TTY mcp-server node -e '
  fetch("http://127.0.0.1:3100/health").then(async (response) => {
    if (!response.ok) process.exit(1);
    console.log("MCP_HEALTH|PASS");
  });'

for service in decision-engine scheduler; do
  compose exec --no-TTY "${service}" node -e '
    fetch(process.argv[1]).then(async (response) => {
      const payload = await response.json();
      if (response.status !== 501 || payload.health_status !== "NOT_IMPLEMENTED" || payload.ok !== false || payload.actions_executed !== 0 || payload.production_writes !== 0) process.exit(1);
      console.log(`${payload.service.toUpperCase()}_HEALTH|PASS|status=NOT_IMPLEMENTED|actions=0|production_writes=0`);
    });' "http://127.0.0.1:$([[ "${service}" = decision-engine ]] && echo 3301 || echo 3303)/health"
done

compose exec --no-TTY ingestion-worker node -e '
  fetch("http://127.0.0.1:3302/health").then(async (response) => {
    const payload = await response.json();
    if (response.status !== 503 || payload.ok !== false || payload.actions_executed !== 0 || payload.production_writes !== 0) process.exit(1);
    console.log("INGESTION_HEALTH|PASS|status=UNHEALTHY|actions=0|production_writes=0");
  });'

compose exec --no-TTY mcp-server node --input-type=module -e '
  import { createPostgresReadRepository } from "./packages/suleia-operations-mcp/src/data/postgres-read-repository.mjs";
  const repository = createPostgresReadRepository({ databaseUrl: process.env.MCP_DATABASE_URL, toolTimeoutMs: 10000 });
  const result = await repository.getDataFreshness();
  const invalidFresh = result.sources.some((source) => source.freshness_status === "FRESH" && source.age_seconds > source.freshness_threshold_seconds);
  if (invalidFresh || !result.sources.length) process.exit(1);
  console.log(JSON.stringify({ check: "SOURCE_FRESHNESS", ok: true, freshness_status: result.freshness_status, sources: result.sources }));
  process.exit(0);'

column_count="$(compose exec --no-TTY postgres psql --no-psqlrc --tuples-only --no-align \
  --username suleia_admin --dbname "${POSTGRES_DB:-suleia_staging}" --command \
  "select count(*) from information_schema.columns where table_schema='read_models' and table_name='operations_data_freshness' and column_name in ('source_observed_at','source_event_at','ingested_at','last_successful_sync_at','sync_complete');")"
[[ "${column_count}" = "5" ]]
echo 'DATABASE_FRESHNESS_CONTRACT|PASS|columns=5'

compose exec --no-TTY mcp-server node -e '
  fetch("http://keycloak:9000/auth/health/ready").then(async (response) => {
    const payload = await response.json();
    if (!response.ok || payload.status !== "UP") process.exit(1);
    console.log("KEYCLOAK_READINESS|PASS|status=UP");
  });'

compose --profile maintenance run --rm --no-TTY backup \
  /bin/sh /opt/suleia/backup/verify_backup.sh "${BACKUP_FILE}" >/dev/null
echo 'BACKUP_INTEGRITY|PASS'

curl --fail --silent --show-error --output /dev/null https://mcp.suleia.com/operations/
curl --fail --silent --show-error --output /dev/null https://mcp.suleia.com/auth/realms/suleia/.well-known/openid-configuration
mcp_status="$(curl --silent --output /dev/null --write-out '%{http_code}' https://mcp.suleia.com/mcp)"
[[ "${mcp_status}" = "401" ]]
echo 'AUDITOR_EDGE|PASS|panel=200|discovery=200|unauthenticated_mcp=401'

echo 'SOURCE_FRESHNESS_DEPLOY_VERIFICATION|PASS|actions=0|production_writes=0'
