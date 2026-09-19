#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test "${RUN_MODE:-SHADOW_READ_ONLY}" = "SHADOW_READ_ONLY"
test "${ACTION_EXECUTOR_ENABLED:-false}" = "false"
test "${PRODUCTION_WRITES_ENABLED:-false}" = "false"
psql "${OPERATIONS_DATABASE_URL:?}" -v ON_ERROR_STOP=1 -f "$root/migrations/040_incident_autopilot_shadow.sql"
echo 'INCIDENT_AUTOPILOT_MIGRATION|PASS|mode=SHADOW_READ_ONLY|external_actions=0|production_writes=0'
