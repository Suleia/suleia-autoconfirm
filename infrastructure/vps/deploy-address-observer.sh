#!/usr/bin/env bash
# Read-only Autonomous Operations presentation; additive SELECT views only.
set -Eeuo pipefail
revision="${1:?exact revision required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
branch=feat/address-panel-observation
install=/opt/suleia-operations
resolved="$(readlink -f "$install")"
[[ "$resolved" =~ ^/opt/suleia-releases/[0-9a-f]{40}$ ]] || exit 2
release="/opt/suleia-releases/$revision"
backup="/opt/suleia-backups/address-observer-$revision"
[[ ! -e "$release" && ! -e "$backup" ]] || exit 2
cd "$install"
[[ -z "$(git status --porcelain)" ]] || exit 2
git cat-file -e "$revision^{commit}"
umask 077
mkdir -p "$backup"
chmod 0700 "$backup"
services=(api review-panel ingestion-worker)
unchanged=(mcp-server scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring)
for service in "${services[@]}";do
  docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-before.json"
done
for service in "${unchanged[@]}";do
  docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1" > "$backup/$service-id-before"
done
docker inspect --format '{{.Id}}' recipient-absent-live-controller > "$backup/absent-controller-id-before"
sha256sum .env > "$backup/env.sha256"
printf '%s\n' "$resolved" > "$backup/previous-release"
(umask 022;git clone --local --no-hardlinks "$install" "$release";git -C "$release" checkout --detach "$revision")
cp --preserve=mode "$install/.env" "$release/.env"
cd "$release"
cmp "$resolved/apps/review-panel/styles.css" apps/review-panel/styles.css
cmp "$resolved/apps/review-panel/results-dashboard.js" apps/review-panel/results-dashboard.js
cmp "$resolved/apps/review-panel/results-dashboard.css" apps/review-panel/results-dashboard.css
cmp "$resolved/packages/platform-core/src/finance/results-report.mjs" packages/platform-core/src/finance/results-report.mjs
# Provider automation is unchanged; address read-side projections are additive.
git diff --exit-code "$(git -C "$resolved" rev-parse HEAD)" "$revision" -- autoconfirm >/dev/null
image="suleia-address-observer:$revision"
docker build -f infrastructure/docker/Dockerfile.node --build-arg "OCI_REVISION=$revision" \
  --build-arg OCI_SOURCE=https://github.com/Suleia/suleia-autoconfirm --build-arg "OCI_REF_NAME=$branch" \
  --build-arg "OCI_CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg "OCI_VERSION=${revision:0:8}" -t "$image" .
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges -e NODE_ENV=test \
  --tmpfs /app/autoconfirm/data:rw,mode=1777 -v "$release/autoconfirm/data:/test-data:ro" \
  -v "$release/infrastructure:/app/infrastructure:ro" -v "$release/migrations:/app/migrations:ro" \
  -v "$release/scripts:/app/scripts:ro" -v "$release/docs:/app/docs:ro" \
  -v "$release/autoconfirm:/app/autoconfirm:ro" --entrypoint sh "$image" \
  -c 'cp -R /test-data/. /app/autoconfirm/data/ && exec node "$@"' sh --input-type=module -e '
  import {readdirSync} from "node:fs";let files=[];
  for(const dir of ["packages/platform-core/test","packages/suleia-operations-mcp/test","packages/suleia-operations-mcp/src/operations","apps/api","apps/review-panel","services","infrastructure","autoconfirm","scripts"])
    for(const e of readdirSync(dir,{recursive:true,withFileTypes:true}))if(e.isFile()&&e.name.endsWith(".test.mjs"))files.push(`${e.parentPath}/${e.name}`);
  const {spawnSync}=await import("node:child_process");const r=spawnSync(process.execPath,["--test","--test-concurrency=1","--test-reporter=tap",...files],{encoding:"utf8",maxBuffer:20*1024*1024});
  console.log(r.stdout.split("\n").filter(l=>/^# (tests|pass|fail|duration)|^not ok/.test(l)).join("\n"));if(r.status!==0){console.error(r.stdout.split("\n").flatMap((line,i,lines)=>line.startsWith("not ok")?lines.slice(i,i+45):[]).join("\n"));process.exit(r.status||1);}
  console.log("INCIDENT_PANEL_IMAGE_TESTS|PASS");' | tee "$backup/image-tests.txt"
docker exec -i suleia-operations-staging-postgres-1 psql -X -v ON_ERROR_STOP=1 -U suleia_admin -d suleia_staging < migrations/049_address_owner_observations.sql
compose=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
"${compose[@]}" config --format json > "$backup/current-compose.json"
override="$backup/runtime-preserving-override.json"
jq -n --arg image "$image" --arg revision "$revision" --arg branch "$branch" --arg panel "$release/apps/review-panel" \
  --slurpfile cfg "$backup/current-compose.json" --slurpfile api "$backup/api-before.json" --slurpfile review "$backup/review-panel-before.json" --slurpfile ingestion "$backup/ingestion-worker-before.json" '
  def original($s):{image:$s[0][0].Config.Image,environment:($s[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($s[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))};
  {services:{"ingestion-worker":(original($ingestion)+{image:$image,environment:(($cfg[0].services["ingestion-worker"].environment|with_entries(.value=null))+(original($ingestion).environment|with_entries(select(.key|startswith("SULEIA_BUILD_")|not)))+{"SULEIA_BUILD_REVISION":$revision,"SULEIA_BUILD_BRANCH":$branch})}),api:(original($api)+{image:$image,environment:(($cfg[0].services.api.environment|with_entries(.value=null))+(original($api).environment|with_entries(select(.key|startswith("SULEIA_BUILD_")|not)))+{"SULEIA_BUILD_REVISION":$revision,"SULEIA_BUILD_BRANCH":$branch})}),"review-panel":(original($review)|.volumes|=map(if .target=="/usr/share/nginx/html" then .source=$panel else . end))}}' > "$override"
jq -n --slurpfile api "$backup/api-before.json" --slurpfile review "$backup/review-panel-before.json" --slurpfile ingestion "$backup/ingestion-worker-before.json" '
  def original($s):{image:$s[0][0].Config.Image,environment:($s[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($s[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))};
  {services:{"ingestion-worker":original($ingestion),api:original($api),"review-panel":original($review)}}' > "$backup/rollback.json"
rollback(){ trap - ERR; "${compose[@]}" -f "$backup/rollback.json" up -d --no-deps --no-build api review-panel ingestion-worker >/dev/null; }
trap rollback ERR
"${compose[@]}" -f "$override" up -d --no-deps --no-build api review-panel ingestion-worker
for service in "${services[@]}";do
  docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-after.json"
  for phase in before after;do
    jq -c '.[0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|sort' "$backup/$service-$phase.json" > "$backup/$service-$phase-env.json"
    jq -c '.[0]|{cmd:.Config.Cmd,entrypoint:.Config.Entrypoint,user:.Config.User,restart:.HostConfig.RestartPolicy,networks:(.NetworkSettings.Networks|keys|sort),mounts:(.Mounts|map(select(.Destination!="/usr/share/nginx/html")|{source:.Source,target:.Destination,write:.RW}))}' "$backup/$service-$phase.json" > "$backup/$service-$phase-config.json"
  done
  cmp "$backup/$service-before-env.json" "$backup/$service-after-env.json"
  cmp "$backup/$service-before-config.json" "$backup/$service-after-config.json"
  jq -e '.[0].Config.Env|all(test("^(AUSENTE_AUTOMATION_LIVE|CHATBY_REAL_SENDS|DROPEA_ACTIONS_ENABLED|GLS_ACTIONS_ENABLED)=true$")|not)' "$backup/$service-after.json" >/dev/null
done
for service in "${unchanged[@]}";do
  [[ "$(docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1")" == "$(cat "$backup/$service-id-before")" ]]
done
[[ "$(docker inspect --format '{{.Id}}' recipient-absent-live-controller)" == "$(cat "$backup/absent-controller-id-before")" ]]
healthy=false
for attempt in {1..20};do
  if docker exec suleia-operations-staging-api-1 wget -qO- http://127.0.0.1:3200/health > "$backup/api-health.json";then healthy=true;break;fi
  sleep 2
done
[[ "$healthy" == true ]]
for asset in index.html app.js results-dashboard.js results-dashboard.css incident-panel.js incident-panel.css automation-panel.js automation-panel.css;do
  docker exec suleia-operations-staging-review-panel-1 wget -qO- "http://127.0.0.1/$asset" > "$backup/served-$asset"
  cmp "$backup/served-$asset" "$release/apps/review-panel/$asset"
done
"${compose[@]}" exec -T --interactive=false postgres psql -X -At -U suleia_admin -d suleia_staging -c \
  "SELECT count(*) FROM operations.incident_action_outbox WHERE external_write_attempted OR actions_executed<>0 OR production_writes<>0" | grep -qx 0
sha256sum -c "$backup/env.sha256" >/dev/null
link="/opt/suleia-operations-results-v2-$revision"
[[ ! -e "$link" && ! -L "$link" ]] || exit 2
ln -s "$release" "$link"
mv -T "$link" "$install"
trap - ERR
printf 'INCIDENT_PANEL_DEPLOY|commit=%s|env_preserved=true|eight_other_services_and_absent_controller_unchanged=true|migrations=1_readonly_views|services=api,panel,ingestion|incident_external_writes=0\n' "$revision"
