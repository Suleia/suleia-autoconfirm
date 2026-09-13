#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${INSTALL_ROOT:-/opt/suleia-operations}"
ENV_FILE="${INSTALL_ROOT}/private-secrets/.env"
MIGRATION_FILE="${INSTALL_ROOT}/migrations/033_finance_order_reconciliation.sql"

test -r "${ENV_FILE}"
test -r "${MIGRATION_FILE}"
set -a
source "${ENV_FILE}"
set +a
exec psql --host /var/run/postgresql --username "${POSTGRES_USER:-suleia_admin}" \
  --dbname "${POSTGRES_DB:-suleia_staging}" --set ON_ERROR_STOP=1 --file "${MIGRATION_FILE}"
