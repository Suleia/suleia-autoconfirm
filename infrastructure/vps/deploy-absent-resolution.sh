#!/usr/bin/env bash
# Resolution code and panel deployment; all existing LIVE flags stay unchanged.
set -Eeuo pipefail
revision="${1:?exact commit required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
branch=feat/absent-real-resolution
install=/opt/suleia-operations
resolved="$(readlink -f "$install")"
[[ "$resolved" =~ ^/opt/suleia-releases/[0-9a-f]{40}$ ]] || exit 2
release="/opt/suleia-releases/$revision"
backup="/opt/suleia-backups/absent-resolution-$revision"
[[ ! -e "$release" && ! -e "$backup" ]] || exit 2
cd "$install"
[[ -z "$(git status --porcelain)" ]] || exit 2
git cat-file -e "$revision^{commit}"
umask 077
mkdir -p "$backup"; chmod 0700 "$backup"
compose=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
services=(api mcp-server ingestion-worker)
docker inspect suleia-operations-staging-review-panel-1 > /dev/null
for service in "${services[@]}"; do
  docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-before.json"
done
for service in "${services[@]}"; do
  jq -e '.[0].Mounts|all(.Type=="bind" and .RW==false and .Destination=="/app/private-runtime" and (.Source|test("^/opt/suleia-releases/[0-9a-f]{40}/private-runtime$")))' "$backup/$service-before.json" >/dev/null
  jq -e '.[0].HostConfig.PortBindings|length==0' "$backup/$service-before.json" >/dev/null
  jq -e '.[0].Config.Env|all(test("^(AUSENTE_AUTOMATION_LIVE|CHATBY_REAL_SENDS|DROPEA_ACTIONS_ENABLED|GLS_ACTIONS_ENABLED)=true$")|not)' "$backup/$service-before.json" >/dev/null
done
docker inspect suleia-operations-staging-review-panel-1 > "$backup/panel-before.json"
for service in scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring; do
  docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1" > "$backup/$service-id-before"
done
sha256sum .env > "$backup/env.sha256"
printf '%s\n' "$resolved" > "$backup/previous-release"
"${compose[@]}" exec -T --interactive=false postgres pg_dump -U suleia_admin -d suleia_staging --schema-only > "$backup/schema.sql"
"${compose[@]}" exec -T --interactive=false postgres pg_dump -U suleia_admin -d suleia_staging --format=custom \
  --schema=operations --schema=configuration --schema=read_models > "$backup/database.dump"
[[ -s "$backup/database.dump" ]] || exit 2
(umask 022; git clone --local --no-hardlinks "$install" "$release"; git -C "$release" checkout --detach "$revision")
cp --preserve=mode "$install/.env" "$release/.env"
cd "$release"
sha256sum -c "$backup/env.sha256" >/dev/null
# Enforce the authorized workflow boundary before building.
git diff --exit-code "$(git -C "$resolved" rev-parse HEAD)" "$revision" -- autoconfirm apps/api packages/platform-core/src/finance apps/review-panel/results-dashboard.js apps/review-panel/results-dashboard.css apps/review-panel/styles.css infrastructure/docker >/dev/null
image="suleia-absent-resolution:$revision"
docker build -f infrastructure/docker/Dockerfile.node --build-arg "OCI_REVISION=$revision" \
  --build-arg OCI_SOURCE=https://github.com/Suleia/suleia-autoconfirm --build-arg "OCI_REF_NAME=$branch" \
  --build-arg "OCI_CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg "OCI_VERSION=${revision:0:8}" -t "$image" .
# Actual new image tests, not an old catalog count. Source additions read-only;
# the current image's installed modules and modified executable files are used.
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges -e NODE_ENV=test \
  --tmpfs /app/autoconfirm/data:rw,mode=1777 -v "$release/autoconfirm/data:/test-data:ro" \
  -v "$release/infrastructure:/app/infrastructure:ro" -v "$release/migrations:/app/migrations:ro" \
  -v "$release/scripts:/app/scripts:ro" -v "$release/docs:/app/docs:ro" \
  -v "$release/autoconfirm:/app/autoconfirm:ro" --entrypoint sh "$image" -c 'cp -R /test-data/. /app/autoconfirm/data/ && exec node "$@"' sh --input-type=module -e '
    import {readdirSync} from "node:fs";let files=[];
    for(const dir of ["packages/platform-core/test","packages/suleia-operations-mcp/test","packages/suleia-operations-mcp/src/operations","apps/api","apps/review-panel","services","infrastructure","autoconfirm","scripts"]){
      for(const entry of readdirSync(dir,{recursive:true,withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith(".test.mjs"))files.push(`${entry.parentPath}/${entry.name}`);
    }
    const {spawnSync}=await import("node:child_process");const run=spawnSync(process.execPath,["--test","--test-reporter=tap",...files],{encoding:"utf8",maxBuffer:20*1024*1024});
    console.log(run.stdout.split("\n").filter(l=>/^# (tests|pass|fail|duration)|^not ok/.test(l)).join("\n"));if(run.status!==0){console.error(run.stdout.slice(-14000));process.exit(run.status || 1);}
    console.log("CURRENT_IMAGE_TESTS|PASS");' | tee "$backup/image-tests.txt"
"${compose[@]}" config --format json > "$backup/current-compose.json"
override="$backup/runtime-preserving-override.json"
jq -n --arg image "$image" --arg revision "$revision" --arg branch "$branch" --arg release "$release" --slurpfile panel "$backup/panel-before.json" --slurpfile cfg "$backup/current-compose.json" \
  --slurpfile api "$backup/api-before.json" --slurpfile mcp "$backup/mcp-server-before.json" --slurpfile worker "$backup/ingestion-worker-before.json" '
  def service($s;$name):{image:$image,environment:(($cfg[0].services[$name].environment|with_entries(.value=null))+($s[0][0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries)+{"SULEIA_BUILD_REVISION":$revision,"SULEIA_BUILD_BRANCH":$branch}),volumes:($s[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:true}))};
  {services:{api:service($api;"api"),"mcp-server":service($mcp;"mcp-server"),"ingestion-worker":service($worker;"ingestion-worker"),"review-panel":{image:$panel[0][0].Config.Image,environment:($panel[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($panel[0][0].Mounts|map({type:"bind",source:(if .Destination=="/usr/share/nginx/html" then $release+"/apps/review-panel" else .Source end),target:.Destination,read_only:(.RW|not)}))}}}' > "$override"
jq -n --slurpfile panel "$backup/panel-before.json" --slurpfile api "$backup/api-before.json" --slurpfile mcp "$backup/mcp-server-before.json" --slurpfile worker "$backup/ingestion-worker-before.json" '
  def original($s):{image:$s[0][0].Config.Image,environment:($s[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($s[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))};
  {services:{api:original($api),"mcp-server":original($mcp),"ingestion-worker":original($worker),"review-panel":original($panel)}}' > "$backup/rollback.json"
rollback(){
  trap - ERR
  "${compose[@]}" -f "$backup/rollback.json" up -d --no-deps --no-build api mcp-server ingestion-worker review-panel >/dev/null
}
trap rollback ERR
docker exec -i suleia-operations-staging-postgres-1 psql -X -v ON_ERROR_STOP=1 -U suleia_admin -d suleia_staging < migrations/042_recipient_absent_resolutions.sql > "$backup/migration042.txt"
for migration in 043_absent_execution_integrity 044_absent_carrier_compound_registry 045_absent_native_notification_gate; do
  docker exec -i suleia-operations-staging-postgres-1 psql -X -v ON_ERROR_STOP=1 -U suleia_admin -d suleia_staging < "migrations/$migration.sql" > "$backup/$migration.txt"
done
[[ "$(docker exec suleia-operations-staging-postgres-1 psql -X -At -U suleia_admin -d suleia_staging -c "SELECT count(*) FROM operations.recipient_absent_resolution_control WHERE workflow='RECIPIENT_ABSENT' AND status='DISABLED'")" == 1 ]]
"${compose[@]}" -f "$override" up -d --no-deps --no-build api mcp-server ingestion-worker review-panel
for service in "${services[@]}"; do
  docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-after.json"
  for phase in before after; do
    jq -c '.[0].Config.Env|map(select(test("^SULEIA_BUILD_")|not))|sort' "$backup/$service-$phase.json" > "$backup/$service-$phase-env.json"
    jq -c '.[0]|{cmd:.Config.Cmd,entrypoint:.Config.Entrypoint,user:.Config.User,restart:.HostConfig.RestartPolicy,networks:(.NetworkSettings.Networks|keys|sort),mounts:(.Mounts|map({source:.Source,target:.Destination,write:.RW}))}' "$backup/$service-$phase.json" > "$backup/$service-$phase-config.json"
  done
  cmp "$backup/$service-before-env.json" "$backup/$service-after-env.json"
  cmp "$backup/$service-before-config.json" "$backup/$service-after-config.json"
done
for service in scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring; do
  [[ "$(docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1")" == "$(cat "$backup/$service-id-before")" ]]
done
healthy=false
for attempt in {1..20}; do
  if docker exec suleia-operations-staging-api-1 wget -qO- http://127.0.0.1:3200/health > "$backup/api-health.json" \
    && docker exec suleia-operations-staging-mcp-server-1 wget -qO- http://127.0.0.1:3100/health > "$backup/mcp-health.json"; then healthy=true;break;fi
  sleep 2
done
[[ "$healthy" == true ]]
sha256sum -c "$backup/env.sha256" >/dev/null
link="/opt/suleia-operations-absent-resolution-$revision"
[[ ! -e "$link" && ! -L "$link" ]] || exit 2
ln -s "$release" "$link";mv -T "$link" "$install"
trap - ERR
install -m 0644 infrastructure/vps/suleia-runtime-inventory.service /etc/systemd/system/
install -m 0644 infrastructure/vps/suleia-runtime-inventory.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now suleia-runtime-inventory.timer
bash infrastructure/vps/refresh-absent-runtime.sh
printf 'ABSENT_RESOLUTION_DEPLOY|commit=%s|env_preserved=true|other_services_unchanged=true|migrations=042|services=api,mcp,ingestion,panel|writer=DISABLED|mode=SHADOW\n' "$revision"
