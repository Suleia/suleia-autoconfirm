# Address import recovery — post-failure only

Owner's architecture correction, 25 October 2026. Policy `address-post-failure-v1`.

## Boundary

```
Existing importer → Dropea → success → END
                         ↘ persisted definitive failure → isolated consumer
                              address whitelist → recovery case
                              anything else → existing handling
```

No preflight, healthy-order scan, new normal-import hook, scheduler modification,
global lock, normal retry modification, tag change, Dropea ID replacement or
confirmation change. Existing PR117 native-import reconciliation remains unchanged.
That older worker's full reconciliation is not duplicated by this service.

`services/import-recovery/shadow.mjs` consumes **only already persisted audit
records** from PR117. It correlates an attempted POST to the exact order/reference,
idempotency key, definitive HTTP400 ValidationFailure and timestamped rejection.
The rejection record itself is the durable event; no later result append is needed.
Blocked planning results, absence from Dropea, an order tag, guessed textual
matches and success are not import-failure evidence. Malformed/truncated logs
fail closed. Identical payload/code rejections remain one failure generation;
a new payload/code creates a new generation. Evidence is retained encrypted.

No normal importer file imports this service. Success creates zero address cases,
claims, provider reads, corrections or Chatby messages. The SHADOW service has no
network namespace access, no provider credentials and no live entrypoint. It is
triggered only by the provider-rejection file changing, never by a success report,
not by another importer or
full-store polling job. If no persisted failure exists, it creates no state directory,
database, case or projection. It has its own resource limits, private database and
unprivileged process; it never takes the existing worker's cycle lock.

## Error governance

The eight canonical codes in the owner's whitelist require a governed event with
the explicit policy mapping version. Real Dropea Public API V2 mappings observed
in the private deployed audit are exact, versioned comparisons:

| Provider ValidationFailure code | Governed class | Handling |
| --- | --- | --- |
| `POSTAL_CODE_NOT_COVERED` | `NO_CARRIER_FOR_ADDRESS` | Coverage review; never treat as proof of a bad CP or substitute an address |
| `shipping_address address lines together must not exceed 100 characters` | `ADDRESS_INVALID` / `ADDRESS_LINES_TOO_LONG` | Address validation/customer clarification; never truncate a street automatically |
| `FULL_NAME_LENGTH_EXCEEDED` | NON_ADDRESS | Existing handling; no address recovery |

401/403/429/5xx, non-definitive results, timeouts and all other codes remain out of
scope regardless of their message text. No unknown error is promoted to ADDRESS.
Native Shopify app failures are not claimed to be observable: only its existing
persisted, governed event could be consumed. The fallback predicate/search for
`error_dropea`/`dropea_error` is specified and tested but **not enabled**. Tags alone
are insufficient evidence, and attributes cannot justify a full-store scan.

## Durable model and privacy

`order_import_recovery_case` is in a dedicated SQLite database, using SQLite's
durable transactions, FULL synchronous commits, unique `(shopify_order_id,
failure_generation)` and a partial unique index allowing one active case/order.
This database never locks the operational/importer database. Metadata includes
external reference hash, failure code/class/category, detected time, address
status, confidence, customer/Shopify/Dropea status, provider order ID, next action,
safe last error and resolution time. `original_error`, full external reference,
candidate, validation evidence and address snapshots are encrypted together with
AES-256-GCM, random IV and case-ID authenticated data in `private_ciphertext`.
No customer contacts, messages or addresses are exposed in audit/projection/Git.

Every state transition is audited by case/order/time/state/reason. Effects are
claimed durably before dispatch; version checks prevent stale writers. Leases
are **per order** and do not automatically expire into another write after a
crash. A stranded lease needs operator reconciliation; never delete an effect
claim or release one merely because time passed. Different failure generations
cannot silently reuse an earlier address decision. A new error during an unknown
effect is encrypted, held and forces reclassification without a blind retry.

States: IMPORT_FAILED → CLASSIFIED → OUT_OF_SCOPE, or ADDRESS_RECOVERY_REQUIRED →
VALIDATING → AUTO_CORRECTED / WAITING_CUSTOMER → CUSTOMER_ADDRESS_RECEIVED →
VERIFIED_ADDRESS → REIMPORT_PENDING → IMPORT_VERIFIED. Existing references become
ALREADY_IMPORTED, with address-problem evidence PRESENT/ABSENT/NOT_VERIFIABLE;
unknown evidence remains a review task, never an invented resolved incident.

## Controlled write engine

The separately tested `AddressRecoveryAgent` accepts narrow injected ports; it is
**not a production-connected live worker**. Before any recovery it requires a
fresh, complete exact-reference lookup for the correct store. One match prevents
reimport; multiple/incomplete/stale/unknown results block. Before a shipping
correction it rereads the exact Shopify order and checks the entire non-address
source invariant, original address, cancellation, fulfillment/refunds and payment
context. Name/phone/company are preserved and verified separately. The Shopify
adapter can send only `orderUpdate { id, shippingAddress }`, once, without the
normal read retry wrapper; it has no customer-profile, tags or financial mutation.

A HIGH candidate requires confidence >=.95, exactly one candidate, trusted
validation evidence and a query including street, house number, locality,
province and country matching that failed order. Province-only evidence cannot
qualify. Multiple candidates force LOW. The first implementation auto-corrects
only an otherwise matching full address, such as a uniquely verified postal
correction. Wider geographic/street changes require a complete customer address
and the same independent verification. A no-op candidate cannot resolve a failed
address. Address length is not fixed by silent truncation.

There is currently **no configured authoritative address resolver**. No invented
confidence, postal table guessed from province, external paid service, model or
API key is introduced. The resolver port must be integrated and proven before
phase2. Phase1 needs none.

MEDIUM/LOW requires the existing `dropea_incidencia_direccion_v1` template. The
Chatby port must prove exact current Shopify order, shop, reference, conversation
and fresh evidence; phone alone/old fields cannot qualify. It reserves the
**existing** per-order template ledger and a local effect claim before sending.
Timeouts are not resent. A customer reply must be complete, from the customer,
after the request, still the latest relevant message and independently address
validated; later cancellation/correction blocks the write. Only this order's
shipping address may change, never the global customer profile.

Reimport requires a verified correction, a fresh exact-reference count0, fresh
source unchanged, the existing stock/SKU/payment/price-safe import builder and
its exact expected total/units/store/address. Claim:
`SHOPIFY_DROPEA_RECOVERY:<shopify_order_id>`. The port must additionally acquire
the **existing writer's same-order persistent reservation** and prove native retry
quiescence. A fresh GET alone cannot exclude a concurrent native writer. Until
that coordination is proven, phase4 must remain off. Do not change global retries
to implement it. Only one dispatch is allowed; no automatic POST retry, even
after a definitive rejection. A changed failure is classified again. A fresh
exact lookup must return exactly one complete order whose ID, address, total,
variant quantities, currency and store verify; otherwise the state stays unknown.

These live ports (resolver, Chatby proof/shared ledger, existing builder/writer
reservation) still require production integration/acceptance before their phases
can be enabled. The SHADOW binary deliberately refuses any write flags and has
no path to activate them by editing an environment boolean.

## Flags and rollback

Independent flags, with strict boolean parsing and enforced order:

1. `ADDRESS_IMPORT_RECOVERY_ENABLED=true`; all write flags false: SHADOW.
2. `ADDRESS_RECOVERY_SHOPIFY_WRITE=true`: only verified corrections.
3. `ADDRESS_RECOVERY_CHATBY_SEND=true`: gated existing address template/replies.
4. `ADDRESS_RECOVERY_DROPEA_IMPORT=true`: gated single recovery import.

None inherits global production flags. Before phase2/3/4, implement and validate
the corresponding missing live ports with fresh owner-approved scope, exact-order
canary and postconditions. Never label phase1 observation as automatic recovery.
Disable/stop only the new `.path`/service and set the master flag false to stop
all recovery processing. Existing importing continues unchanged. Do not remove
the recovery database or claims on rollback. After an in-flight action reconcile
it before any retry. Removing the optional API projection mount/path removes the
new card; no normal order/incident rows are changed.

## Panel and measurements

Optional read-only API projection behind the existing OAuth boundary. Small
"Errores de importación — X pendientes" card on Pedidos opens `#import-recovery`;
separate view/filter, existing six-section sidebar unchanged. No action buttons.
The normal queue renders before the optional local projection is fetched. The
API mounts only the contact-free projection, not private DB/audit/key. Stale or
unavailable reads display unknown, never a misleading zero.

Metrics count the failed-case universe only: `address_import_failures`,
`address_recoverable`, `auto_corrected`, `customer_required`, `recovered`,
`manual_review`, `duplicates_prevented`. They are not all Shopify orders.

Regression covers the unchanged 28-test PR117 importer suite, new success no-op,
error classification, exact identity/count/freshness, confidence, customer scope,
later messages, independent flags, generation/lease/idempotency, encryption,
postconditions, uncertainty and OAuth/UI. Source hashes prove normal import code,
unit/timer/config unchanged. This establishes no new code path or provider quota
requests for healthy orders; it is **not a production latency SLA measurement**
or proof of native-app successful imports. Do not create a fake real customer order
to manufacture latency/recovery evidence. Release receipts distinguish fixture
tests, real persisted failure observation and any later live canary.

Official schema used: [Shopify 2026-04 orderUpdate](https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/orderUpdate)
and [MailingAddressInput](https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/MailingAddressInput).
