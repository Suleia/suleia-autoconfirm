# Failed-address recovery on the VPS

Continuation of the existing isolated PR150 service, owner authorized 29 October.
The regular Shopify→Dropea importer and its :05/:35 timer are unchanged.

The previous observer had no connected correction adapters. The new :10/:40 UTC
timer consumes its same encrypted cases and persisted provider failures, plus a
bounded server-filtered query for `error_dropea`/`dropea_error` orders only. It is
independent of Codex and the owner's PC. The old observation path is disabled to
keep a single recovery owner. No healthy orders are scanned or validated here.

Native intake requires a Dropea-app-authored `note_created` event for that exact
order, its observed native app identity, and a body equal to the current
address-bound error note. Only three observed signatures are mapped: malformed
postal code, city too short and no carrier for the supplied postcode. A tag,
missing provider reference or a normal import planning block is never sufficient.
Unknown failures retain their existing handling. Failure evidence stays encrypted.

Correction is shipping-address-only, with independent master/write flags. The
official [IGN/CNIG CartoCiudad resolver](https://github.com/IDEESpain/Cartociudad)
must return exactly one matching portal: street, number/extension, locality,
province, Spain and a five-digit postcode, then confirm that entity independently
with `find`. This exact-match policy scores 1; it is a policy score, not an
asserted provider probability. Truncated/multiple/fuzzy/street-only results never
authorize a correction. No missing house number, street or city is invented.
Queries omit names, contacts, flat/floor, payment and order identifiers.

Coverage alone is not proof of an invalid postcode. Only an independently proven
different postcode for the same full address may be corrected. A correct address
with no carrier remains a coverage review. Older than seven days, cancelled,
fulfilled, refunded, changed and uncertain orders require review. Historical
orders are not recreated merely because an exact reference is missing.

Before a write: exact reference lookup, fresh source invariants, per-order lease
and durable effect claim; shipping contact fields are preserved explicitly.
The write transport does not retry. A separate GET verifies the address, contacts
and non-address source. Unknown effects are reconciled, never resent.

**Creation owner:** this lane makes zero Dropea POSTs. After correction, the
existing native/regular importer continues to own creation with its established
reservation and idempotency. The next recovery cycle independently verifies the
unique provider reference, total, units and full address before counting a
recovery. This avoids adding a second writer or pretending native retry quiescence.

**Current rollout:** Shopify correction on; recovery Chatby sends and direct
Dropea imports off. Cases needing a missing/ambiguous address are visible in
Import Recovery as requiring the exact current-order contact to be verified.
They are not presented as messages sent. The pre-import Chatby binding/response
adapter remains unconnected; do not enable its boolean or reuse a phone-only
subscriber match. Existing normal templates and incident workflows are unchanged.

Inspect `systemctl status suleia-address-import-recovery.timer` and the private
`/var/lib/suleia-address-import-recovery/overview.json`; require a fresh completion
and `coverageComplete=true`, not merely an active timer. The sanitized projection
continues under the existing OAuth protected Import Recovery view.

Rollback: stop/disable only the new recovery timer/service; restore the captured
previous worker symlink and optional single panel asset, then re-enable the old
shadow path. Preserve encrypted database, key, effects, leases and audit. Do not
roll back customer addresses blindly, clear claims, change the ordinary importer,
its timer/environment or unrelated services. Private deployment receipts hold
captured hashes and rollback data; no customer records belong in GitHub.
