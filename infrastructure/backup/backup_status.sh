#!/bin/sh
set -eu
latest="$(ls -1t /backups/suleia-*.dump 2>/dev/null | head -1 || true)"
test -n "$latest" || { echo '{"ok":false,"error":"no_backup_found"}'; exit 1; }
printf '{"ok":true,"latest":"%s"}\n' "$(basename "$latest")"
