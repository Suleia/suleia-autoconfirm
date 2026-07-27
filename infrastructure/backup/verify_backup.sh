#!/bin/sh
# shellcheck shell=sh
set -eu
test -n "${1:-}" || { echo "Usage: verify_backup.sh /backups/file.dump"; exit 1; }
sha256sum -c "${1}.sha256"
pg_restore --list "$1" >/dev/null
echo "Backup checksum and archive structure verified. Full restore test is still required."
