# Current-order confirmation from customer text

The owner authorized repairing and activating contextual text confirmation on
2026-10-23. This change extends the existing Render confirmation workflow; it
does not add another executor, sender or authorization mechanism.

## Diagnosis

The old deterministic rules recognized a limited set of affirmative phrases.
Other clear first-person requests to receive or send an order fell through to
the optional model. The recorded model failure was `insufficient_quota` /
`credit_balance_exhausted`, not a temporary rate limit. The operational panel
also classified text independently of persistent confirmation tags, allowing
inconsistent evidence to be displayed.

For the reported order, a fresh provider GET during investigation already
showed `SHIPPING / AWAITING_PICKUP` with a provider confirmation timestamp.
This repair therefore does not issue another confirmation for that order and
does not claim ownership of the earlier provider action. Customer messages,
identity, credentials and full private receipts stay outside Git.

## Behavior

- The existing interpreter recognizes affirmative desire to receive the
  current order, requests to send it, and explicit acceptance, including
  natural subject/verb variations. No button or one exact phrase is required.
- Questions, quoted text, unresolved conditions, payment impediments, a
  conflicting mentioned price or another explicit order reference hold the
  confirmation for review. A short acknowledgement cannot settle an earlier
  cancellation, question or requested change.
- Inbound evidence is sorted chronologically and scoped to order creation.
  Later cancellation, change or uncertainty takes precedence. Existing
  complete-address business rules remain, while a later cancellation wins.
- Both the panel and the executor use the same interpretation. Old tags and
  different-order conversations cannot override current customer evidence.
  Review cases have a visible reason and action label.
- The existing bounded, paginated Chatby reader is reused for complete history.
  Bot messages are excluded from customer consent. Incomplete history fails
  closed.
- Text follows the existing one-hour timer from the dated consent. At expiry,
  the existing duplicate guard remains, then strict phone/current-order
  subscriber matching, a fresh pending-order GET and a final Chatby read run
  before the existing idempotent Dropea action. Missing consent, a rematched
  conversation, read failure or a nonpending order prevents confirmation.
- Existing provider idempotency keys, audit/mirroring and post-action
  verification remain. The optional model configuration is unchanged; no key,
  model, credit purchase, customer message or template is introduced.

This is a bounded deterministic interpretation with conservative review for
unresolved language, not a claim of universal language understanding. The
optional model remains unavailable until its API billing issue is addressed.

## Validation and release

Synthetic regression covers affirmative variations, punctuation-free
questions, negation, conditional acceptance, current/old/other-order messages,
later contradictions, panel parity, one-hour delay, unavailable/changed final
reads, duplicate guards, disabled real confirmations and postcondition order.
Run all `autoconfirm/**/*.test.mjs` in Linux without network or production
credentials, with a fresh store configuration and the versioned finance test
fixtures.

Final Linux validation: 567/567 tests, 60 files, zero skips; Node 24.20,
network disabled and no production credentials supplied.

Deploy only this branch on top of Render revision `e7c10a6`. Advance the four
existing exact-revision address regression gates to the tested commit so the
release does not disable existing capabilities; preserve all other settings.
Do not deploy Ads V8 or change incident services, Meta, imports, discounts or
templates. Verify the Render revision/readiness and the exact provider order
after deployment. Rollback is the prior Render revision plus the prior values
of those four gates; never replay uncertain provider actions.

## Current-order field parity repair

An exact customer confirmation could start the one-hour wait and then be held
incorrectly at expiry. The Chatby client recognized `#Pedido`, `Pedido` and
`ID Pedido`, while the workflow's duplicate parser accepted only field names
containing `Dropea`. The final check consequently rejected a conversation that
the client's strict phone/order resolver had already matched. The operational
note misleadingly reported that the association was no longer exact.

The workflow now imports the existing client accessor instead of maintaining
another field parser. The accessor is null-safe: a missing strict subscriber
remains a review hold. This changes no field values, phone matching, delay,
templates or provider actions. The same exact lookup, later-message checks,
fresh pending GET, duplicate guard, idempotency and verification remain required.
Synthetic control-flow regressions cover the three affected aliases, the old
Dropea field, different orders/phones, absent fields with old confirmation tags
and contradictory fields. No customer content is used as a fixture.

Validation for the field-parity repair: **575/575 tests**, 60 files, zero skips,
in isolated Linux Node24.20 with network disabled and no production credentials.
The new final-flow fixtures failed for the three non-Dropea aliases on the prior
revision. Windows sandbox temporary-file rename permissions prevented that
local runner from starting; the release evidence comes from the isolated Linux
run. Deploy this repair over `0906530`, advancing only the same four existing
exact-revision gates after their complete regression suite passes.
