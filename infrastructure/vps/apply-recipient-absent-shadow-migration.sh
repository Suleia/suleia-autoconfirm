#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
resolved="$(readlink -f "${INSTALL_ROOT}")"
[[ "$resolved" =~ ^/opt/suleia-releases/[0-9a-f]{40}$ ]]
cd "${INSTALL_ROOT}"
docker compose --env-file .env --file infrastructure/docker/compose.yaml exec --no-TTY postgres \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username suleia_admin --dbname suleia_staging \
  < migrations/035_recipient_absent_shadow.sql
echo 'RECIPIENT_ABSENT_SHADOW|PASS|external_actions=0|production_writes=0'
