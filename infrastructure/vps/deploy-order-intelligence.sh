#!/usr/bin/env bash
# Additive BI deployment. No operational source table or provider action.
set -Eeuo pipefail
revision="${1:?exact commit required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
install=/opt/suleia-operations
resolved="$(readlink -f "$install")"
[[ "$resolved" =~ ^/opt/suleia-releases/[0-9a-f]{40}$ ]] || exit 2
release="/opt/suleia-releases/$revision"
backup="/opt/suleia-backups/order-intelligence-$revision"
[[ ! -e "$release" && ! -e "$backup" ]] || exit 2
cd "$install"
git -c safe.directory="$resolved" cat-file -e "$revision^{commit}"
umask 077
mkdir -p "$backup";chmod 0700 "$backup"
for service in api mcp-server review-panel; do docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-before.json";done
docker ps --format '{{.Names}} {{.ID}}' | grep -vE 'staging-(api|mcp-server|review-panel)-1$' > "$backup/all-containers-before.txt"
for service in ingestion-worker scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring; do docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1" > "$backup/$service-id-before";done
sha256sum .env > "$backup/env.sha256"
printf '%s\n' "$resolved" > "$backup/previous-release"
(umask 022;git -c safe.directory="$resolved" clone --local --no-hardlinks "$install" "$release";git -c safe.directory="$release" -C "$release" checkout --detach "$revision")
cp --preserve=mode "$install/.env" "$release/.env"
cd "$release"
image="suleia-order-intelligence:$revision"
docker build -f infrastructure/docker/Dockerfile.node --build-arg "OCI_REVISION=$revision" --build-arg OCI_SOURCE=https://github.com/Suleia/suleia-autoconfirm --build-arg OCI_REF_NAME=feat/order-intelligence --build-arg "OCI_CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" -t "$image" .
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges -e NODE_ENV=test \
 -v "$release/infrastructure:/app/infrastructure:ro" -v "$release/migrations:/app/migrations:ro" -v "$release/scripts:/app/scripts:ro" -v "$release/docs:/app/docs:ro" -v "$release/autoconfirm:/app/autoconfirm:ro" \
 --entrypoint node "$image" --input-type=module -e '
 import {readdirSync} from "node:fs";import {spawnSync} from "node:child_process";let files=[];
 for(const dir of ["packages/platform-core/test","packages/suleia-operations-mcp/test","packages/suleia-operations-mcp/src/operations","apps/api","apps/review-panel"])
 for(const e of readdirSync(dir,{recursive:true,withFileTypes:true}))if(e.isFile()&&e.name.endsWith(".test.mjs"))files.push(`${e.parentPath}/${e.name}`);
 const r=spawnSync(process.execPath,["--test","--test-reporter=tap",...files],{encoding:"utf8",maxBuffer:30*1024*1024});
 console.log(r.stdout.split("\n").filter(l=>/^# (tests|pass|fail|duration)|^not ok/.test(l)).join("\n"));if(r.status!==0){console.log(r.stdout.slice(-18000));process.exit(r.status||1);}' | tee "$backup/tests.txt"
compose=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
"${compose[@]}" config --format json > "$backup/compose-before.json"
python3 infrastructure/vps/prepare-order-intelligence.py "$backup" "$release" "$image" "$revision"
docker exec -i suleia-operations-staging-postgres-1 psql -X -U suleia_admin -d suleia_staging -v ON_ERROR_STOP=1 < migrations/053_order_intelligence.sql > "$backup/migration.txt"
docker exec -i suleia-operations-staging-postgres-1 psql -X -U suleia_admin -d suleia_staging -v ON_ERROR_STOP=1 < "$backup/role-password.sql" > /dev/null
# Delete only this exact one-use private SQL file; the scoped job env remains
# in the approved private VPS secret directory for restarts and rollback.
rm -- "$backup/role-password.sql"
override="$backup/runtime-override.json"
rollback(){ trap - ERR;"${compose[@]}" -f "$override" stop analytics-materializer >/dev/null 2>&1 || true;"${compose[@]}" -f "$backup/rollback.json" up -d --no-deps --no-build api mcp-server review-panel >/dev/null; }
trap rollback ERR
"${compose[@]}" -f "$override" run --rm --no-deps analytics-materializer node packages/suleia-operations-mcp/src/analytics/materialize.mjs --once | tee "$backup/backfill.jsonl"
"${compose[@]}" -f "$override" up -d --no-deps --no-build api mcp-server review-panel analytics-materializer
for service in api mcp-server;do
 docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-after.json"
 for phase in before after;do jq -c '.[0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|sort' "$backup/$service-$phase.json" > "$backup/$service-$phase-env.json";done
 cmp "$backup/$service-before-env.json" "$backup/$service-after-env.json"
done
for service in ingestion-worker scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring;do [[ "$(docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1")" == "$(cat "$backup/$service-id-before")" ]];done
healthy=false
for attempt in {1..25};do if docker exec suleia-operations-staging-api-1 wget -qO- http://127.0.0.1:3200/health > "$backup/api-health.json" && docker exec suleia-operations-staging-mcp-server-1 wget -qO- http://127.0.0.1:3100/health > "$backup/mcp-health.json";then healthy=true;break;fi;sleep 2;done
[[ "$healthy" == true ]]
docker exec suleia-operations-staging-mcp-server-1 node packages/suleia-operations-mcp/src/analytics/verify.mjs > "$backup/verification.json"
sha256sum -c "$backup/env.sha256" >/dev/null
link="/opt/suleia-operations-analytics-$revision"
[[ ! -e "$link" && ! -L "$link" ]] || exit 2
ln -s "$release" "$link";mv -T "$link" "$install"
trap - ERR
printf 'ORDER_INTELLIGENCE_DEPLOY|commit=%s|services=api,mcp,panel,analytics-materializer|other_services_unchanged=true|source_writes=0|business_actions=0\n' "$revision"
