#!/usr/bin/env bash
# Private infrastructure audit. Read the encrypted/private backup locally only;
# load timer rows into a transaction-local temporary table, then roll back.
set -Eeuo pipefail
revision="${1:?pre-deployment backup revision required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
backup="/opt/suleia-backups/incident-notification-evidence-$revision/database.dump"
[[ -f "$backup" ]] || exit 2
container=suleia-operations-staging-postgres-1
{
  printf 'BEGIN; CREATE TEMP TABLE task_prior_timers (LIKE operations.incident_timers);\n'
  docker exec -i "$container" pg_restore --data-only --table=incident_timers --file=- < "$backup" \
    | sed -n '/^COPY operations\.incident_timers /,/^\\\.$/p' \
    | sed 's/^COPY operations\.incident_timers /COPY task_prior_timers /'
  printf '%s\n' "SELECT count(*) AS prior_timers,
    count(*) FILTER(WHERE c.timer_id IS NULL) AS missing_existing_timers,
    count(*) FILTER(WHERE ROW(p.started_at,p.due_at,p.timer_type,p.policy_version,p.canonical_issue_id,p.canonical_order_id)
      IS DISTINCT FROM ROW(c.started_at,c.due_at,c.timer_type,c.policy_version,c.canonical_issue_id,c.canonical_order_id)) AS changed_timer_invariants,
    count(*) FILTER(WHERE to_jsonb(p) IS DISTINCT FROM to_jsonb(c)) AS changed_existing_rows
    FROM task_prior_timers p LEFT JOIN operations.incident_timers c USING(timer_id);
    ROLLBACK;"
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U suleia_admin -d suleia_staging
exit 0
