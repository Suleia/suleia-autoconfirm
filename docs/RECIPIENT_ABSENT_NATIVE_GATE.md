# Native AUSENTE admission gate

The Chatby native owner remains `f295175s4478867`, element `526887`.
Render remains blocked with `AUSENTE_NOTIFICATION_OWNER=chatby_native`.
The dedicated `recipient-absent-native-worker.mjs` authorizes a native flow; it
contains neither a template sender nor a Dropea writer.

## Required native routing

Only the AUSENTE branch may enter the HTTP action. The request uses POST
`/absent/native/authorize`, bearer authentication from trusted secret storage,
and `{issue_id, order_id, user_ns}` from the current trigger. Do not use name or
phone as identity. The one successful route must match response code `201`
exactly and enter the v3 node. All other responses and the default continuation
must stop. Never map `allow` to a subscriber field: concurrent runs could reuse
a stale value. Do not connect or publish this route before its authentication,
response handling, rollback and complete mapping snapshots are verified.

## Persistent control

Migration 045 starts DISABLED. The three native booleans are the persisted
equivalents of `AUSENTE_AUTOMATION_LIVE`, `AUSENTE_NATIVE_SEND_ENABLED` and
`AUSENTE_TEMPLATE_SENDS_ENABLED`. Runtime cannot enable itself or change gate
evidence. The existing resolution ledger also consults the master control and
native circuit breaker before claiming and before writing.

Admission directly rereads the exact current issue/order/conversation, requires
complete history, and permits only new FIRST_ABSENCE incidents without a prior
notice. SECOND_ABSENCE remains in the existing policy review path. A transaction
locks the control row, inserts the unique issue+version claim and reserves the
single canary slot before returning `201`. A lost response leaves CLAIMED;
automatic retries never return a second grant. This proves admission uniqueness,
not undocumented internal delivery behavior of the native provider.

An independent provider-history read must verify the actual notice. Only that
read may persist SENT/VERIFIED and the 48-hour timer in one transaction. V2 after
claim or multiple V3 notices trip the scoped breaker. Timers never originate
from issue creation. Failed and uncertain deliveries require reconciliation;
they do not release the original claim.

## Activation evidence still required

Unit fixtures and configured node destinations are not real callbacks. The
callback verifier requires an OBSERVED_REAL contract, the current verified v3
notice, exact conversation, provider reply context and later event timestamp.
Complete graph snapshots must contain workflow, subflow, node, elements,
template IDs/names/locales and edges. The comparator rejects catalog-only data
and changes to any node outside the explicit AUSENTE node allowlist.

Publication, real notification canary, real AM/PM/OTHER callbacks and resolution
canary are separate production gates. Do not label this implementation LIVE
merely because its tests pass. Rollback stops admission and resolution through
the master DB control, preserves ledgers, and restores the previous native
published mapping only from a verified snapshot.
