#!/usr/bin/env bash
# Finance-read-model/UI only. No schema, worker, messaging or Render changes.
set -Eeuo pipefail
revision="${1:?exact revision required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
branch=fix/results-return-rate-daily-clarity
install=/opt/suleia-operations
resolved="$(readlink -f "$install")"
[[ "$resolved" =~ ^/opt/suleia-releases/[0-9a-f]{40}$ ]] || exit 2
release="/opt/suleia-releases/$revision"
backup="/opt/suleia-backups/results-clarity-$revision"
[[ ! -e "$release" && ! -e "$backup" ]] || exit 2
cd "$install"
[[ -z "$(git status --porcelain)" ]] || exit 2
git cat-file -e "$revision^{commit}"
umask 077
mkdir -p "$backup"
chmod 0700 "$backup"
compose=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
docker inspect suleia-operations-staging-api-1 > "$backup/api-before.json"
docker inspect suleia-operations-staging-review-panel-1 > "$backup/panel-before.json"
jq -e '.[0].Mounts|all(.Type=="bind" and .RW==false and .Destination=="/app/private-runtime" and (.Source|test("^/opt/suleia-releases/[0-9a-f]{40}/private-runtime$")))' "$backup/api-before.json" >/dev/null
jq -e '.[0].HostConfig.PortBindings|length==0' "$backup/api-before.json" >/dev/null
for service in mcp-server ingestion-worker scheduler decision-engine; do
  docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1" > "$backup/$service-id-before"
done
sha256sum .env > "$backup/env.sha256"
git rev-parse HEAD > "$backup/previous-commit"
(umask 022; git clone --local --no-hardlinks "$install" "$release"; git -C "$release" checkout --detach "$revision")
cp --preserve=mode "$install/.env" "$release/.env"
cd "$release"
sha256sum -c "$backup/env.sha256" >/dev/null
image="suleia-results-clarity:$revision"
docker build -f infrastructure/docker/Dockerfile.node --build-arg "OCI_REVISION=$revision" \
  --build-arg OCI_SOURCE=https://github.com/Suleia/suleia-autoconfirm --build-arg "OCI_REF_NAME=$branch" \
  --build-arg "OCI_CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg "OCI_VERSION=${revision:0:8}" -t "$image" .
docker run --rm --network none --entrypoint node "$image" --input-type=module -e \
  'await import("./packages/platform-core/src/finance/daily-settlements.mjs");console.log("FINANCE_IMAGE_IMPORT|PASS")'
"${compose[@]}" config --format json > "$backup/current-compose.json"
override="$backup/runtime-preserving-override.json"
jq -n --arg image "$image" --arg revision "$revision" --arg branch "$branch" \
  --slurpfile cfg "$backup/current-compose.json" --slurpfile api "$backup/api-before.json" '
  {services:{api:{image:$image,environment:(($cfg[0].services.api.environment|with_entries(.value=null))+($api[0][0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries)+{"SULEIA_BUILD_REVISION":$revision,"SULEIA_BUILD_BRANCH":$branch}),volumes:($api[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:true}))}}}' > "$override"
jq -n --slurpfile api "$backup/api-before.json" --slurpfile panel "$backup/panel-before.json" '
  def original($snapshot):{image:$snapshot[0][0].Config.Image,environment:($snapshot[0][0].Config.Env|map(capture("^(?<key>[^=]+)=(?<value>.*)$"))|from_entries),volumes:($snapshot[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:(.RW|not)}))};
  {services:{api:original($api),"review-panel":original($panel)}}' > "$backup/rollback.json"
rollback() { "${compose[@]}" -f "$backup/rollback.json" up -d --no-deps --no-build api review-panel >/dev/null; }
trap rollback ERR
"${compose[@]}" -f "$override" up -d --no-deps --no-build api review-panel
docker inspect suleia-operations-staging-api-1 > "$backup/api-after.json"
for phase in before after; do
  jq -c '.[0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|sort' "$backup/api-$phase.json" > "$backup/$phase-env.json"
  jq -c '.[0]|{cmd:.Config.Cmd,entrypoint:.Config.Entrypoint,user:.Config.User,restart:.HostConfig.RestartPolicy,networks:(.NetworkSettings.Networks|keys|sort),mounts:(.Mounts|map({source:.Source,target:.Destination,write:.RW}))}' "$backup/api-$phase.json" > "$backup/$phase-config.json"
done
cmp "$backup/before-env.json" "$backup/after-env.json"
cmp "$backup/before-config.json" "$backup/after-config.json"
for service in mcp-server ingestion-worker scheduler decision-engine; do
  docker inspect --format '{{.Id}}' "suleia-operations-staging-$service-1" > "$backup/$service-id-after"
  cmp "$backup/$service-id-before" "$backup/$service-id-after"
done
healthy=false
for attempt in {1..10}; do
  if docker exec suleia-operations-staging-api-1 wget -qO- http://127.0.0.1:3200/health > "$backup/health.json"; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]]
sha256sum -c "$backup/env.sha256" >/dev/null
link="/opt/suleia-operations-results-$revision"
[[ ! -e "$link" && ! -L "$link" ]] || exit 2
ln -s "$release" "$link"
mv -T "$link" "$install"
trap - ERR
printf 'RESULTS_DEPLOY|commit=%s|env_preserved=true|other_services_unchanged=true|database_migrations=0|services=api,panel\n' "$revision"
