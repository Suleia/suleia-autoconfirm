# GLS operational policies

Version: `gls-es-shadow-v1.0.0`

The Incident Processor references 18 versioned policy IDs (`GLS-01` through
`GLS-18`). They implement conservative business-day and 17:00 Europe/Madrid
cutoff handling, no same-day promise, no next-day guarantee after cutoff,
attempt-aware risk, current evidence after refusal, independent retention and
customer timers, COD/label verification, no inspection before payment, and no
pickup details without verified evidence.

These policies produce estimates and review flags, never delivery guarantees.
TIPSA is explicitly outside the operational policy and routes to review.

No carrier action exists in this module. `GLS-18` remains a mandatory future
pre-execution re-read gate.
