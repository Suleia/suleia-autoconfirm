# Rollback plan

## Triggers

- PII exposure.
- Data mismatch.
- Missing events.
- Duplicate decisions.
- Unauthorized write.
- Health or latency outside approved limits.
- Backup or restore failure.

## Procedure

1. Disable ingress to the new platform.
2. Disable workers and schedulers.
3. Preserve logs and database snapshot.
4. Route traffic back to Render.
5. Verify Render and Supabase health.
6. Reconcile any writes made during the window.
7. Document the incident and root cause.

The old platform is not removed during the rollback period.
