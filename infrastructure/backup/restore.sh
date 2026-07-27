#!/bin/sh
# shellcheck shell=sh
set -eu
test "${ALLOW_RESTORE:-false}" = "true" || { echo "Restore blocked: set ALLOW_RESTORE=true in an isolated database."; exit 1; }
test -n "${1:-}" || { echo "Usage: restore.sh /backups/file.dump"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$PGDATABASE" "$1"
