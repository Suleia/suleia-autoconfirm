#!/bin/sh
set -eu

test "${ALLOW_STAGING_EXPORT:-false}" = "true" || {
  echo "Export blocked. Set ALLOW_STAGING_EXPORT=true for an authorized read-only staging export."
  exit 1
}
test -n "${SUPABASE_READONLY_DATABASE_URL:-}" || {
  echo "Missing SUPABASE_READONLY_DATABASE_URL."
  exit 1
}

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${EXPORT_DIR:-/exports}/supabase-staging-${stamp}.dump"
pg_dump "$SUPABASE_READONLY_DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$target"
sha256sum "$target" > "${target}.sha256"
printf '{"ok":true,"file":"%s"}\n' "$(basename "$target")"
