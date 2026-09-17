# Rejected-goods automation recovery — 2026-09-17

Scope: Render autoconfirm only, from live/main
`2d52bc541db0bc2bb34bc8c3395ddf3eb9ae549c`. Owner authorized repair,
autonomous discounts and governed returns. No finance/VPS deployment, AUSENTE
activation, other template/flow/policy changes, new credential or migration.

## Production evidence before rollout

- 16:52:58 UTC cycle: eleven rejected incidents blocked by unreadable Chatby.
  All discount/return live flags enabled; interval fifteen minutes.
- Chatby subsequently recovered without a manually triggered sweep: the
  17:24:24 UTC scheduled cycle verified customer context with zero blocked reads.
- Persistent return ledger contained four verified actions and five failed
  actions (429/503). Independent official GET `/dropshipper/issues/{id}` reads
  confirmed all four verified actions as `RESOLVED/RETURN_REQUESTED`.
- Four failed actions were now inactive without a return resolution. One was
  active `MANAGING_WITH_CLIENT` without a return resolution. Neither condition
  proves that a return was requested.
- The official V2 contract defines `MANAGING_WITH_CLIENT` and `RESOLVED` as final
  workflow states: carrier `allowed_resolution_options` alone cannot authorize
  a second workflow transition. That active case needs Dropea intervention;
  retries cannot safely override the contract.
- Two verified discounts were still inside their 24-hour response windows,
  expiring 2026-09-18 at 14:06:21 and 14:56:10 UTC. No premature return is allowed.

## Corrections

- Honor Chatby Retry-After dates/seconds and quota-reset headers; rate-limited
  reads fail fast instead of multiplying calls through nested local retries.
- Coalesced nonblocking recovery retries also cover temporary network read
  failures and last-moment rejected-return reads. Success cancels obsolete
  timers; recovery status is observable in health.
- A single discount scheduler owns the complete incident synchronization when
  enabled. The duplicate generic incident timer is disabled only in that case;
  standalone incident synchronization remains when recovery is disabled.
- Existing delayed 5xx reconciliation remains; 429 is now recoverable too.
  Every write still requires exact current PENDING/active/return-allowed issue
  and fresh verified Chatby context under the existing business rule.
- Return post-verification uses the exact owned V2 issue endpoint. A missing
  issue on an order or absence from a pending list is never proof of a return.
- Failed/stale claims are reconciled against exact Dropea state, including
  cases that have left the pending list. Inactive-without-return and final
  managed cases receive truthful distinct terminal ledger states.
- Unknown network/write-schema outcomes keep their persistent attempt nonce
  for replay within Dropea's 24-hour idempotency window. HTTP clients never
  blindly retry POSTs. Current issue and customer context are revalidated.

## Verification boundaries

Full autoconfirm suite must pass before publication. Deploy the exact published
commit to Render (autoDeploy remains unchanged); verify buildRevision, unchanged
business flags, persistent reconciliation, and natural scheduled cycles without
manual sweep endpoints. Append actual deployment/test evidence after rollout.

External services can still respond 429/503. Recovery must be autonomous and
safe; unreadable Chatby must never be interpreted as customer silence. The final
managed-state case is an external workflow limitation, not a claimed return.
