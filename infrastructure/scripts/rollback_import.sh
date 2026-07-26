#!/bin/sh
set -eu

test "${ALLOW_STAGING_ROLLBACK:-false}" = "true" || {
  echo "Rollback blocked. Set ALLOW_STAGING_ROLLBACK=true for an isolated staging database."
  exit 1
}
case "${PGHOST:-}" in
  *prod*|*production*) echo "Rollback blocked: target hostname looks like production."; exit 1 ;;
esac

psql --no-psqlrc --set ON_ERROR_STOP=1 --file=migrations/rollback/002_platform_schema.down.sql
psql --no-psqlrc --set ON_ERROR_STOP=1 --file=migrations/rollback/001_roles.down.sql
