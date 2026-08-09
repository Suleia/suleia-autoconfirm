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

compose exec --no-TTY api node --input-type=module -e '
  import { OperationsRepository } from "./packages/suleia-operations-mcp/src/operations/repository.mjs";
  const repository = await OperationsRepository.connect(process.env.OPERATIONS_DATABASE_URL);
  const result = await repository.summary();
  const invalidFresh = result.connectors.some((connector) => connector.freshness_status === "FRESH" && connector.age_seconds > connector.freshness_threshold_seconds);
  if (invalidFresh || !result.connectors.length) process.exit(1);
  console.log(JSON.stringify({ check: "OPERATIONS_CONNECTOR_HEALTH", ok: true,
    connectors: result.connectors.map(({ connector, health_status, data_health, freshness_status, age_seconds, freshness_threshold_seconds }) =>
      ({ connector, health_status, data_health, freshness_status, age_seconds, freshness_threshold_seconds })) }));
  await repository.close();'

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

restore_status="${INSTALL_ROOT}/private-runtime/backup-restore-status.json"
test -r "${restore_status}"
checked_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
health_file="${INSTALL_ROOT}/private-runtime/functional-health.json"
health_tmp="${health_file}.tmp"
install -d -m 0755 "${INSTALL_ROOT}/private-runtime"
printf '%s\n' "{
  \"schema_version\": \"suleia-functional-health-v1\",
  \"checked_at\": \"${checked_at}\",
  \"components\": [
    {\"service\":\"api\",\"health_status\":\"HEALTHY\",\"reason\":\"Read API answered and safety counters remained zero.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"endpoint\":\"internal:/health\",\"status\":200}},
    {\"service\":\"mcp-server\",\"health_status\":\"HEALTHY\",\"reason\":\"MCP health and canonical PostgreSQL freshness read succeeded.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"endpoint\":\"internal:/health\",\"status\":200}},
    {\"service\":\"ingestion-worker\",\"health_status\":\"UNHEALTHY\",\"reason\":\"No successful complete cycle; the known Chatby read dependency remains unauthorized.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"endpoint\":\"internal:/health\",\"status\":503}},
    {\"service\":\"decision-engine\",\"health_status\":\"NOT_IMPLEMENTED\",\"reason\":\"No functional autonomous decision cycle is deployed.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"endpoint\":\"internal:/health\",\"status\":501}},
    {\"service\":\"timer-engine\",\"health_status\":\"NOT_IMPLEMENTED\",\"reason\":\"Timer evaluation exists as a simulation module but no autonomous timer service is deployed.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"runtime_service\":false}},
    {\"service\":\"scheduler\",\"health_status\":\"NOT_IMPLEMENTED\",\"reason\":\"No functional scheduling cycle is deployed.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"endpoint\":\"internal:/health\",\"status\":501}},
    {\"service\":\"keycloak\",\"health_status\":\"HEALTHY\",\"reason\":\"Keycloak readiness reported UP.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"endpoint\":\"internal:/auth/health/ready\",\"status\":200}},
    {\"service\":\"postgres\",\"health_status\":\"HEALTHY\",\"reason\":\"PostgreSQL accepted a read and exposes the five canonical freshness fields.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"canonical_freshness_columns\":5}},
    {\"service\":\"review-panel\",\"health_status\":\"HEALTHY\",\"reason\":\"The private Operations Center entry point answered over TLS.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"endpoint\":\"public:/operations/\",\"status\":200}},
    {\"service\":\"mcp-edge\",\"health_status\":\"HEALTHY\",\"reason\":\"OIDC discovery succeeded and unauthenticated MCP access was rejected.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":null,\"evidence\":{\"discovery_status\":200,\"unauthenticated_mcp_status\":401}},
    {\"service\":\"backup\",\"health_status\":\"HEALTHY\",\"reason\":\"Backup checksum, archive, isolated restore and cleanup were verified.\",\"checked_at\":\"${checked_at}\",\"last_completed_cycle_at\":\"${checked_at}\",\"evidence\":{\"backup\":\"${BACKUP_FILE##*/}\",\"restore_record\":\"backup-restore-status.json\"}}
  ]
}" > "${health_tmp}"
chmod 0644 "${health_tmp}"
mv "${health_tmp}" "${health_file}"

bash "${INSTALL_ROOT}/infrastructure/vps/collect-platform-runtime-inventory.sh" >/dev/null
echo 'FUNCTIONAL_HEALTH_INVENTORY|PASS|components=11'

echo 'SOURCE_FRESHNESS_DEPLOY_VERIFICATION|PASS|actions=0|production_writes=0'
