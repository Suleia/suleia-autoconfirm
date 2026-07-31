# Render decommission plan

Render shutdown is migration Phase 7 and is not authorized.

Prerequisites: full VPS authority already owner-approved, stable progressive
cutover, no pending Render-only jobs, archived deployment configuration,
exported safe logs, reconciled schedules/webhooks, verified rollback window,
DNS and health monitoring, financial confirmation and a final backup.

Planned sequence is freeze configuration, disable duplicate schedules after
verified VPS authority, observe, preserve rollback image/configuration, remove
traffic, verify no callbacks, export final audit, then cancel paid resources
only with explicit owner approval. Any parity, data, webhook or queue anomaly
restores routing and schedules to Render.
