#!/bin/sh
# shellcheck shell=sh
set -eu
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/backups/suleia-${stamp}.dump"
retention_days="${BACKUP_DAILY_RETENTION_DAYS:-14}"
pg_dump --format=custom --compress=9 --no-owner --no-acl --file="$target"
sha256sum "$target" > "${target}.sha256"
find /backups -type f -name 'suleia-*.dump' -mtime "+${retention_days}" -delete
find /backups -type f -name 'suleia-*.dump.sha256' -mtime "+${retention_days}" -delete
printf '{"ok":true,"backup":"%s","daily_retention_days":%s,"policy":"%s"}\n' \
  "$(basename "$target")" "$retention_days" "${BACKUP_RETENTION_STATUS:-PENDING_LEGAL_APPROVAL}"
