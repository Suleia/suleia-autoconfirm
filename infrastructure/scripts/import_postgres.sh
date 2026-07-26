#!/bin/sh
set -eu

test "${ALLOW_STAGING_IMPORT:-false}" = "true" || {
  echo "Import blocked. Set ALLOW_STAGING_IMPORT=true only for an isolated staging database."
  exit 1
}
case "${PGHOST:-}" in
  *prod*|*production*) echo "Import blocked: target hostname looks like production."; exit 1 ;;
esac
test -n "${1:-}" || { echo "Usage: import_postgres.sh file.dump"; exit 1; }

pg_restore \
  --single-transaction \
  --no-owner \
  --no-acl \
  --dbname="${PGDATABASE:?Missing PGDATABASE}" \
  "$1"
