#!/bin/sh
set -eu

psql --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
SELECT
  count(*) AS total_events,
  count(DISTINCT deduplication_key) AS unique_deduplication_keys,
  count(*) FILTER (WHERE checksum IS NULL OR checksum = '') AS missing_checksums
FROM events.order_events;

SELECT
  count(*) AS unsafe_decisions
FROM decisions.decision_records
WHERE actions_executed <> 0 OR run_mode <> 'SIMULATION';
SQL
