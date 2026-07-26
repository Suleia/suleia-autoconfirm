# Timer engine

Timers are durable workflow facts rather than in-process timeouts.

## Initial workflows

- `CONFIRMATION_WAIT_1H`: customer confirmation must remain valid for one hour.
- `INCIDENT_RESPONSE_48H`: incident review threshold.
- `LEGACY_UNANSWERED_36H`: comparison-only legacy signal.
- `UNKNOWN_SAFETY_72H`: no automatic cancellation before this threshold.

Timer events are `TIMER_STARTED`, `TIMER_EXPIRED`, `TIMER_COMPLETED` and `TIMER_CANCELLED`. The PostgreSQL job queue will later claim due timers with row locking. Live scheduling remains disabled in staging.
