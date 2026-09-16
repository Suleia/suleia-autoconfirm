#!/usr/bin/env bash
# Isolated publication. Never runs the global staging installer or edits .env.
set -Eeuo pipefail
revision="${1:?exact commit required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
install=/opt/suleia-operations
[[ "$(readlink -f "$install")" == /opt/suleia-operations ]] || exit 2
cd "$install"
[[ -z "$(git status --porcelain)" ]] || { echo 'STOP: dirty source'; exit 2; }
git cat-file -e "$revision^{commit}"
backup="/opt/suleia-backups/recipient-absent-shadow-$revision"
[[ ! -e "$backup/previous-commit" ]] || { echo 'STOP: deployment checkpoint already exists; inspect before resuming'; exit 2; }
mkdir -p "$backup"
chmod 0700 "$backup"
umask 077
compose=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
services=(api mcp-server ingestion-worker)
for service in "${services[@]}"; do
  container="suleia-operations-staging-$service-1"
  docker inspect "$container" > "$backup/$service-before.json"
  jq -e '.[0].Mounts|all(.Type=="bind" and .RW==false and .Destination=="/app/private-runtime" and (.Source|test("^/opt/suleia-releases/[0-9a-f]{40}/private-runtime$")))' "$backup/$service-before.json" >/dev/null
  jq -e '.[0].HostConfig.PortBindings|length==0' "$backup/$service-before.json" >/dev/null
done
git rev-parse HEAD > "$backup/previous-commit"
sha256sum .env > "$backup/env.sha256"
"${compose[@]}" exec -T postgres pg_dump -U suleia_admin -d suleia_staging --format=custom > "$backup/database.dump"
[[ -s "$backup/database.dump" ]] || exit 2
git checkout --detach "$revision"
sha256sum -c "$backup/env.sha256" >/dev/null
bash infrastructure/vps/apply-recipient-absent-shadow-migration.sh
image="suleia-recipient-absent-shadow:$revision"
docker build -f infrastructure/docker/Dockerfile.node --build-arg "OCI_REVISION=$revision" \
  --build-arg OCI_SOURCE=https://github.com/Suleia/suleia-autoconfirm --build-arg OCI_REF_NAME=feat/recipient-absent-shadow-v1 \
  --build-arg "OCI_CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg "OCI_VERSION=${revision:0:8}" -t "$image" .
# Old runtime environment is copied only inside the approved private backup
# directory. It is never printed, passed in arguments or committed.
override="$backup/runtime-preserving-override.json"
jq -n --arg image "$image" --arg revision "$revision" \
  --slurpfile api "$backup/api-before.json" --slurpfile mcp "$backup/mcp-server-before.json" \
  --slurpfile worker "$backup/ingestion-worker-before.json" '
  def service($snapshot): {image:$image,environment:($snapshot[0][0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))+["SULEIA_BUILD_REVISION="+$revision,"SULEIA_BUILD_BRANCH=feat/recipient-absent-shadow-v1"]),volumes:($snapshot[0][0].Mounts|map({type:"bind",source:.Source,target:.Destination,read_only:true}))};
  {services:{api:service($api),"mcp-server":service($mcp),"ingestion-worker":service($worker)}}' > "$override"
"${compose[@]}" -f "$override" up -d --no-deps --no-build api mcp-server ingestion-worker
for service in "${services[@]}"; do
  container="suleia-operations-staging-$service-1"
  docker inspect "$container" > "$backup/$service-after.json"
  # Verify all pre-existing environment values, excluding build provenance.
  for phase in before after; do
    jq -c '.[0].Config.Env|map(select(startswith("SULEIA_BUILD_")|not))|sort' "$backup/$service-$phase.json" > "$backup/$service-$phase-env.json"
  done
  cmp "$backup/$service-before-env.json" "$backup/$service-after-env.json"
  for phase in before after; do
    jq -c '.[0]|{cmd:.Config.Cmd,entrypoint:.Config.Entrypoint,user:.Config.User,restart:.HostConfig.RestartPolicy,networks:(.NetworkSettings.Networks|keys|sort),mounts:(.Mounts|map({source:.Source,target:.Destination,write:.RW}))}' "$backup/$service-$phase.json" > "$backup/$service-$phase-config.json"
  done
  cmp "$backup/$service-before-config.json" "$backup/$service-after-config.json"
done
sha256sum -c "$backup/env.sha256" >/dev/null
printf 'ABSENT_DEPLOY|commit=%s|env_preserved=true|scope=api,mcp,ingestion,panel|live=false\n' "$revision"
