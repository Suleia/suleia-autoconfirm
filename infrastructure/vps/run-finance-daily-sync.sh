#!/usr/bin/env sh
set -eu

release_dir=/opt/suleia-operations
compose_file="$release_dir/infrastructure/docker/compose.yaml"
env_file="$release_dir/.env"
test -f "$compose_file"
test -f "$env_file"
cd "$release_dir"
exec docker compose --env-file "$env_file" -f "$compose_file" --profile finance-sync run --rm finance-daily-sync
