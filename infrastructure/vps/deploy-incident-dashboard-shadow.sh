#!/usr/bin/env bash
# Existing Operations Center plus the simulation-only Incident Autopilot projection.
set -Eeuo pipefail
revision="${1:?exact commit required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
branch=feat/incident-dashboard-v2
install=/opt/suleia-operations
resolved="$(readlink -f "$install")"
[[ "$resolved" =~ ^/opt/suleia-releases/[0-9a-f]{40}$ ]] || exit 2
release="/opt/suleia-releases/$revision"
backup="/opt/suleia-backups/incident-dashboard-shadow-$revision"
[[ ! -e "$release" && ! -e "$backup" ]] || exit 2
cd "$install"
[[ -z "$(git status --porcelain)" ]] || exit 2
git cat-file -e "$revision^{commit}"
umask 077
mkdir -p "$backup";chmod 0700 "$backup"
services=(api mcp-server review-panel ingestion-worker)
for service in "${services[@]}";do
  docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-before.json"
  jq -e '.[0].Config.Env|all(test("^(AUSENTE_AUTOMATION_LIVE|CHATBY_REAL_SENDS|DROPEA_ACTIONS_ENABLED|GLS_ACTIONS_ENABLED)=true$")|not)' "$backup/$service-before.json" >/dev/null
done
for service in scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring;do
  docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1" > "$backup/$service-id-before"
done
sha256sum .env > "$backup/env.sha256"
printf '%s\n' "$resolved" > "$backup/previous-release"
(umask 022;git clone --local --no-hardlinks "$install" "$release";git -C "$release" checkout --detach "$revision")
cp --preserve=mode "$install/.env" "$release/.env"
cd "$release"
# Financial calculations are not part of this change.
cmp "$resolved/packages/platform-core/src/finance/results-report.mjs" "$release/packages/platform-core/src/finance/results-report.mjs"
image="suleia-incident-dashboard-shadow:$revision"
docker build -f infrastructure/docker/Dockerfile.node --build-arg "OCI_REVISION=$revision" \
  --build-arg OCI_SOURCE=https://github.com/Suleia/suleia-autoconfirm --build-arg "OCI_REF_NAME=$branch" \
  --build-arg "OCI_CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg "OCI_VERSION=${revision:0:8}" -t "$image" .
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges -e NODE_ENV=test \
  --tmpfs /app/autoconfirm/data:rw,mode=1777 \
  -v "$release/autoconfirm/data:/test-data:ro" \
  -v "$release/infrastructure:/app/infrastructure:ro" -v "$release/migrations:/app/migrations:ro" \
  -v "$release/scripts:/app/scripts:ro" -v "$release/docs:/app/docs:ro" \
  -v "$release/autoconfirm:/app/autoconfirm:ro" --entrypoint sh "$image" \
  -c 'cp -R /test-data/. /app/autoconfirm/data/ && exec node "$@"' sh --input-type=module -e '
  import {readdirSync} from "node:fs";let files=[];
  for(const dir of ["packages/platform-core/test","packages/suleia-operations-mcp/test","packages/suleia-operations-mcp/src/operations","apps/api","apps/review-panel","services","infrastructure","autoconfirm","scripts"]){
    for(const e of readdirSync(dir,{recursive:true,withFileTypes:true}))if(e.isFile()&&e.name.endsWith(".test.mjs"))files.push(`${e.parentPath}/${e.name}`);
  }
  const {spawnSync}=await import("node:child_process");const r=spawnSync(process.execPath,["--test","--test-reporter=tap",...files],{encoding:"utf8",maxBuffer:20*1024*1024});
  console.log(r.stdout.split("\n").filter(l=>/^# (tests|pass|fail|duration)|^not ok/.test(l)).join("\n"));if(r.status!==0){console.error(r.stdout.slice(-9000));process.exit(r.status||1);}
  console.log("INCIDENT_DASHBOARD_IMAGE_TESTS|PASS");' | tee "$backup/image-tests.txt"
# Preserve the full financial renderer, HTML section and all pre-existing CSS.
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  -v "$resolved:/previous:ro" --entrypoint node "$image" --input-type=module -e '
  import {readFileSync} from "node:fs";import assert from "node:assert/strict";
  const old=readFileSync("/previous/apps/review-panel/app.js","utf8"),next=readFileSync("apps/review-panel/app.js","utf8");
  const financial=s=>s.slice(s.indexOf("function financeMetric("),s.indexOf("function setView("));assert.equal(financial(old),financial(next));
  const section=s=>s.slice(s.indexOf("<section id=\"finance-view\""),s.indexOf("<section id=\"queue-card\"")).split("<section id=\"recovery-center\"")[0].trim();
  assert.equal(section(readFileSync("/previous/apps/review-panel/index.html","utf8")),section(readFileSync("apps/review-panel/index.html","utf8")));
  const unchanged=s=>{const start=s.indexOf("/* Recovery Center");if(start<0)return s;const end=s.indexOf("/* Verified 5 EUR",start);assert.ok(end>start);return s.slice(0,start)+s.slice(end);};
  assert.equal(unchanged(readFileSync("apps/review-panel/styles.css","utf8")),unchanged(readFileSync("/previous/apps/review-panel/styles.css","utf8")));
  console.log("FINANCIAL_RENDERER_BYTES|PRESERVED");'
compose=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
"${compose[@]}" exec -T --interactive=false postgres pg_dump -U suleia_admin -d suleia_staging --schema-only > "$backup/schema-before.sql"
[[ -s "$backup/schema-before.sql" ]]
"${compose[@]}" config --format json > "$backup/current-compose.json"
override="$backup/runtime-preserving-override.json"
jq -n --arg image "$image" --arg revision "$revision" --arg branch "$branch" --arg panel "$release/apps/review-panel" \
  --slurpfile cfg "$backup/current-compose.json" --slurpfile api "$backup/api-before.json" \
  --slurpfile mcp "$backup/mcp-server-before.json" --slurpfile review "$backup/review-panel-before.json" \
  --slurpfile worker "$backup/ingestion-worker-before.json" '
  def original($s):{image:$s[0][0].Config.Image,environment:($s[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($s[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))};
  def runtime($s;$name):original($s)+{image:$image,environment:(($cfg[0].services[$name].environment|with_entries(.value=null))+(original($s).environment|with_entries(select(.key|startswith("SULEIA_BUILD_")|not)))+{"SULEIA_BUILD_REVISION":$revision,"SULEIA_BUILD_BRANCH":$branch})};
  {services:{api:runtime($api;"api"),"mcp-server":runtime($mcp;"mcp-server"),"ingestion-worker":(runtime($worker;"ingestion-worker")|.environment.CHATBY_READ_MAX_CONVERSATIONS="8"),"review-panel":(original($review)|.volumes|=map(if .target=="/usr/share/nginx/html" then .source=$panel else . end))}}' > "$override"
jq -n --slurpfile api "$backup/api-before.json" --slurpfile mcp "$backup/mcp-server-before.json" --slurpfile review "$backup/review-panel-before.json" --slurpfile worker "$backup/ingestion-worker-before.json" '
  def original($s):{image:$s[0][0].Config.Image,environment:($s[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($s[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))};
  {services:{api:original($api),"mcp-server":original($mcp),"review-panel":original($review),"ingestion-worker":original($worker)}}' > "$backup/rollback.json"
rollback(){
  trap - ERR
  "${compose[@]}" -f "$backup/rollback.json" up -d --no-deps --no-build api mcp-server review-panel ingestion-worker >/dev/null || true
  if [[ "${migration_applied:-false}" == true ]];then
    "${compose[@]}" exec -T postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname suleia_staging < migrations/rollback/041_incident_dashboard_context.down.sql || true
  fi
}
trap rollback ERR
migration_applied=false
if ! "${compose[@]}" exec -T --interactive=false postgres psql -X -At -U suleia_admin -d suleia_staging -c \
  "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='read_models' AND table_name='operations_incident_records' AND column_name='dashboard_source_context')" | grep -qx t;then
  "${compose[@]}" exec -T postgres psql --no-psqlrc --set ON_ERROR_STOP=1 \
    --username suleia_admin --dbname suleia_staging < migrations/041_incident_dashboard_context.sql
  migration_applied=true
fi
"${compose[@]}" -f "$override" up -d --no-deps --no-build api mcp-server review-panel ingestion-worker
for service in "${services[@]}";do
  docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-after.json"
  for phase in before after;do
    jq -c --arg service "$service" '.[0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not)|select($service!="ingestion-worker" or (startswith("CHATBY_READ_MAX_CONVERSATIONS=")|not)))|sort' "$backup/$service-$phase.json" > "$backup/$service-$phase-env.json"
    jq -c '.[0]|{cmd:.Config.Cmd,entrypoint:.Config.Entrypoint,user:.Config.User,restart:.HostConfig.RestartPolicy,networks:(.NetworkSettings.Networks|keys|sort),mounts:(.Mounts|map(select(.Destination!="/usr/share/nginx/html")|{source:.Source,target:.Destination,write:.RW}))}' "$backup/$service-$phase.json" > "$backup/$service-$phase-config.json"
  done
  cmp "$backup/$service-before-env.json" "$backup/$service-after-env.json"
  cmp "$backup/$service-before-config.json" "$backup/$service-after-config.json"
  jq -e '.[0].Config.Env|all(test("^(AUSENTE_AUTOMATION_LIVE|CHATBY_REAL_SENDS|DROPEA_ACTIONS_ENABLED|GLS_ACTIONS_ENABLED)=true$")|not)' "$backup/$service-after.json" >/dev/null
done
jq -e '.[0].Config.Env|any(.=="CHATBY_READ_MAX_CONVERSATIONS=8")' "$backup/ingestion-worker-after.json" >/dev/null
for service in scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring;do
  [[ "$(docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1")" == "$(cat "$backup/$service-id-before")" ]]
done
healthy=false
for attempt in {1..20};do
  if docker exec suleia-operations-staging-api-1 wget -qO- http://127.0.0.1:3200/health > "$backup/api-health.json" \
    && docker exec suleia-operations-staging-mcp-server-1 wget -qO- http://127.0.0.1:3100/health > "$backup/mcp-health.json";then healthy=true;break;fi
  sleep 2
done
[[ "$healthy" == true ]]
# Health is deliberately 503 until the first complete read-only cycle. Cold
# legacy ingestion plus eight paced conversations cannot finish in 40 seconds.
# Wait for real readiness, never relabel STARTING/failed reads as healthy.
healthy=false
for attempt in {1..120};do
  if docker exec suleia-operations-staging-ingestion-worker-1 wget -T 5 -qO- http://127.0.0.1:3302/health > "$backup/worker-health.json";then healthy=true;break;fi
  sleep 5
done
[[ "$healthy" == true ]]
docker exec suleia-operations-staging-review-panel-1 wget -qO- http://127.0.0.1/app.js > "$backup/served-app.js"
cmp "$backup/served-app.js" "$release/apps/review-panel/app.js"
"${compose[@]}" exec -T --interactive=false postgres psql -X -At -U suleia_admin -d suleia_staging -c \
  "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='read_models' AND table_name='operations_incident_records' AND column_name='dashboard_source_context')" | grep -qx t
"${compose[@]}" exec -T --interactive=false postgres psql -X -At -U suleia_admin -d suleia_staging -c \
  "SELECT count(*) FROM operations.incident_action_outbox WHERE external_write_attempted OR actions_executed<>0 OR production_writes<>0" | grep -qx 0
sha256sum -c "$backup/env.sha256" >/dev/null
link="/opt/suleia-operations-recovery-center-$revision"
[[ ! -e "$link" && ! -L "$link" ]] || exit 2
ln -s "$release" "$link";mv -T "$link" "$install"
trap - ERR
printf 'INCIDENT_DASHBOARD_DEPLOY|commit=%s|mode=SHADOW_READ_ONLY|env_preserved_except_read_budget=true|seven_other_services_unchanged=true|finance_renderer_preserved=true|migration=041|services=api,mcp,review,readonly-reader|business_actions=0|production_writes=0\n' "$revision"
