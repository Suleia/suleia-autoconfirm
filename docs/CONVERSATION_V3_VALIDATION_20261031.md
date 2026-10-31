# VPS V3 validation continuation

PR182 is reconciled with production baseline 5c9ee98 (runtime image65f00f4) by
ordinary merge8584e64, without rewriting remote history. Its five accepted-discount
hotfix modules remain identical to the current baseline. Scheduler/owners/writers
and financial/template policies are unchanged.

Core V3 modules and replay are synchronized with PR181. Independent pre-canary and
capability promotion gates replace the old combined gate. Tests cover journal
before the single POST, uncertain-result no-retry over later cycles, durable
storage failure, WAMID/readback, waiting persistence and natural-answer consumption.
The runtime adapter now supplies the existing care policy if none was supplied;
missing date/window rules must not disappear at the integration boundary.

SHADOW preserves the exact legacy plan on success and observation/storage failure.
It does not authorize a customer send. Global LIVE cannot bypass exact-case canary
selection. Clarification/status/semantic remain false until individually admitted.
Final SHA test receipts and any conditional deployment/natural-cycle observations
are recorded separately in the Agent Hub. No real canary is claimed here.
