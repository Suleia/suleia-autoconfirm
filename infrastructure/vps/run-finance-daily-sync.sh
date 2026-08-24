#!/usr/bin/env sh
set -eu

release_dir=/opt/suleia-operations
compose_file="$release_dir/infrastructure/docker/compose.yaml"
test -f "$compose_file"
cd "$release_dir"
exec docker compose -f "$compose_file" --profile finance-sync run --rm finance-daily-sync
