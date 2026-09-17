#!/usr/bin/env bash
# Finance API + static panel only. No database migration or business action.
set -Eeuo pipefail
revision="${1:?exact commit required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
branch=fix/finance-purchase-cohort-panel
install=/opt/suleia-operations
resolved="$(readlink -f "$install")"
[[ "$resolved" =~ ^/opt/suleia-releases/[0-9a-f]{40}$ ]] || exit 2
release="/opt/suleia-releases/$revision"
backup="/opt/suleia-backups/finance-purchase-cohort-$revision"
[[ ! -e "$release" && ! -e "$backup" ]] || exit 2
cd "$install"
[[ -z "$(git status --porcelain)" ]] || exit 2
git cat-file -e "$revision^{commit}"
umask 077
mkdir -p "$backup"; chmod 0700 "$backup"
for service in api review-panel; do docker inspect "suleia-operations-staging-$service-1" > "$backup/$service-before.json"; done
for service in mcp-server ingestion-worker scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring; do
  docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1" > "$backup/$service-id-before"
done
sha256sum .env > "$backup/env.sha256"
printf '%s\n' "$resolved" > "$backup/previous-release"
(umask 022; git clone --local --no-hardlinks "$install" "$release"; git -C "$release" checkout --detach "$revision")
cp --preserve=mode "$install/.env" "$release/.env"
cd "$release"
sha256sum -c "$backup/env.sha256" >/dev/null
image="suleia-finance-purchase-cohort:$revision"
docker build -f infrastructure/docker/Dockerfile.node --build-arg "OCI_REVISION=$revision" \
  --build-arg OCI_SOURCE=https://github.com/Suleia/suleia-autoconfirm --build-arg "OCI_REF_NAME=$branch" \
  --build-arg "OCI_CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg "OCI_VERSION=${revision:0:8}" -t "$image" .
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges -e NODE_ENV=test \
  --tmpfs /app/autoconfirm/data:rw,mode=1777 \
  -v "$release/infrastructure:/app/infrastructure:ro" -v "$release/migrations:/app/migrations:ro" \
  -v "$release/scripts:/app/scripts:ro" -v "$release/docs:/app/docs:ro" \
  -v "$release/autoconfirm:/app/autoconfirm:ro" --entrypoint node "$image" --input-type=module -e '
    import {readdirSync} from "node:fs";let files=[];
    for(const dir of ["packages/platform-core/test","packages/suleia-operations-mcp/test","packages/suleia-operations-mcp/src/operations","apps/api","apps/review-panel","services","infrastructure","autoconfirm"]){
      for(const entry of readdirSync(dir,{recursive:true,withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith(".test.mjs"))files.push(`${entry.parentPath}/${entry.name}`);
    }
    const {spawnSync}=await import("node:child_process");const run=spawnSync(process.execPath,["--test","--test-reporter=tap",...files],{encoding:"utf8",maxBuffer:20*1024*1024});
    console.log(run.stdout.split("\n").filter(l=>/^# (tests|pass|fail|duration)|^not ok/.test(l)).join("\n"));if(run.status!==0){console.error(run.stdout.slice(-14000));process.exit(run.status || 1);}
    console.log("CURRENT_FINANCE_IMAGE_TESTS|PASS");' | tee "$backup/image-tests.txt"
compose=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
"${compose[@]}" config --format json > "$backup/current-compose.json"
override="$backup/runtime-preserving-override.json"
jq -n --arg image "$image" --arg revision "$revision" --arg branch "$branch" --slurpfile cfg "$backup/current-compose.json" --slurpfile api "$backup/api-before.json" '
  {services:{api:{image:$image,environment:(($cfg[0].services.api.environment|with_entries(.value=null))+($api[0][0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries)+{"SULEIA_BUILD_REVISION":$revision,"SULEIA_BUILD_BRANCH":$branch}),volumes:($api[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))}}}' > "$override"
jq -n --slurpfile api "$backup/api-before.json" --slurpfile panel "$backup/review-panel-before.json" '
  def original($s):{image:$s[0][0].Config.Image,environment:($s[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($s[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))};
  {services:{api:original($api),"review-panel":original($panel)}}' > "$backup/rollback.json"
rollback(){ trap - ERR; "${compose[@]}" -f "$backup/rollback.json" up -d --no-deps --no-build api review-panel >/dev/null; }
trap rollback ERR
"${compose[@]}" -f "$override" up -d --no-deps --no-build api review-panel
docker inspect suleia-operations-staging-api-1 > "$backup/api-after.json"
for phase in before after; do
  jq -c '.[0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|sort' "$backup/api-$phase.json" > "$backup/api-$phase-env.json"
  jq -c '.[0]|{cmd:.Config.Cmd,entrypoint:.Config.Entrypoint,user:.Config.User,restart:.HostConfig.RestartPolicy,networks:(.NetworkSettings.Networks|keys|sort),mounts:(.Mounts|map({source:.Source,target:.Destination,write:.RW}))}' "$backup/api-$phase.json" > "$backup/api-$phase-config.json"
done
cmp "$backup/api-before-env.json" "$backup/api-after-env.json"
cmp "$backup/api-before-config.json" "$backup/api-after-config.json"
for service in mcp-server ingestion-worker scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring; do
  [[ "$(docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1")" == "$(cat "$backup/$service-id-before")" ]]
done
healthy=false
for attempt in {1..20}; do
  if docker exec suleia-operations-staging-api-1 wget -qO- http://127.0.0.1:3200/health > "$backup/api-health.json"; then healthy=true;break;fi
  sleep 2
done
[[ "$healthy" == true ]]
sha256sum -c "$backup/env.sha256" >/dev/null
link="/opt/suleia-operations-finance-cohort-$revision"
[[ ! -e "$link" && ! -L "$link" ]] || exit 2
ln -s "$release" "$link";mv -T "$link" "$install"
trap - ERR
printf 'FINANCE_COHORT_DEPLOY|commit=%s|env_preserved=true|nine_other_services_unchanged=true|migration=none|services=api,panel|business_actions=0\n' "$revision"
