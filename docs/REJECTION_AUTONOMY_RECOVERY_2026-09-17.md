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

## Actual rollout and independent audit

- Published executable revision `f938a8907394ec693b342d98b5480d563fb730b3`,
  deliberately fast-forwarded to GitHub main without force. Full autoconfirm
  suite: 290 tests, 290 passed, zero failed.
- First exact Render deployment `dep-dam2d2bm8hqs73bbq9lg` became live at
  17:43:36 UTC. Its 17:45:51 UTC autonomous cycle completed with zero failed
  discount sends and zero blocked Chatby reads. No manual sweep endpoint used.
- That cycle reconciled all five previous failed attempts as
  `closed_without_return_request`: even the previously active final managed
  issue had since become inactive. These are not claimed returns. The four
  previously verified returns remain verified.
- At 17:52:44 UTC an independent read-only catalog POST confirmed an actual
  Chatby 429, quota 1000, remaining zero, Retry-After 515 seconds, reset
  `2026-09-17T18:01:19Z`. Render's explicit request pacing was only 2500 ms,
  overriding its default: up to 1440 requests/hour before other readers.
- Changed exactly one nonsecret Render variable:
  `CHATBY_REQUEST_MIN_INTERVAL_MS`, 2500 -> 6000 ms (maximum 600/hour in this
  process). Verified all other 81 service variables byte-identical; no token,
  scope, business flag, timer or other service changed. VPS readonly reader
  already paces at 5000 ms and remains SHADOW with zero real actions.
- Redeployed the same tested executable as `dep-dam2jqu5vjqs73bh50l0`, live
  17:57:58 UTC. Its 17:58:05 UTC natural cycle saw eight quota-blocked rejection
  reads and scheduled its own recovery for 18:01:20.631 UTC, after the actual
  provider reset. No premature send/return, manual sweep or credentials change.
- 17:59:45 UTC independent exact owned-issue GET audit: nine ledger rows,
  four `RESOLVED/RETURN_REQUESTED`, five inactive without that resolution,
  zero discrepancies. Discount ledger has 27 order keys with zero duplicates.

The independent local direct Chatby audit during the exhausted window was
unreadable and is explicitly not evidence of customer silence. Runtime recovery
after the provider reset must be verified separately below.

## Verified unattended recovery after the real 429

- 18:02:28 UTC independent catalog read: HTTP 200, remaining quota 992.
  This diagnostic did not trigger an incident sweep or customer action.
- The recovery timer fired autonomously at 18:01:20.631 UTC. The resulting
  complete incident cycle finished at **18:06:38.869 UTC**, corroborated by the
  Render aggregate log `Incidents sync checked 16 pending incidents.`
- Fresh persistent cache (`updatedAt` denotes cycle start 18:01:20.634 UTC):
  eight rejected incidents, **eight verified Chatby contexts**, zero blocked
  reads, zero failed discount sends, zero cross-source mismatch, zero missing
  verified initial templates. Three had customer activity, three remained
  inside the initial 24-hour window, two already had verified discounts.
- The two discounts remain `NO_RESPONSE/WAITING_24_HOURS`: sent 14:06:21 and
  14:56:10 UTC on Sep17, return windows expire at the same times Sep18
  (16:06:21/16:56:10 Europe/Madrid). A subsequent scheduled cycle must reread
  Chatby and exact eligible Dropea state; no future return is claimed now.
- This verification produced **zero new discount sends and zero new return
  requests** because no current case was due. Their autonomous expiry/action
  path is covered by focused tests; it is not claimed as a new real return.
- Persistent discount audit: 26 verified `sent` rows, two today; one historical
  Sep9 `delivery_unverified` row with no delivery timestamp, absent from the
  current rejected queue. No duplicate order/template key. It was not resent
  or falsely counted as delivered.
- Runtime revision remains `f938a8907394ec693b342d98b5480d563fb730b3` and all
  real discount/automatic return flags remain enabled, 15-minute cadence,
  24-hour response windows, 30-minute transient-action reconciliation delay.
  No manual sweep endpoints, workflow override, new API key, migration, other
  template/flow or VPS/finance deployment was used.

Health's independent Chatby availability probe has its own ten-minute queued
cadence. Its older rate-limited observation is not substituted for the eight
fresh verified case-context reads above; the probe timestamp must be consulted.
