# Suleia agent handoff

Updated: 2026-10-26

## Verified hourly incident review — 26 October 2026

PR #164 deploys the existing dedicated VPS incident worker at revision
`34fb85d7aff23f4cd4304fc56f51ffd1d8b9480b`. The owner requested hourly
autonomous reviews. The interval is now 60 minutes; startup, overlap guard,
25 minute watchdog, current-order evidence, cancellation checks and claims
remain intact. No extra scheduler, sender or Codex heartbeat was created.

The post-restart blank Chatby view exposed during verification is handled by
one bounded reload of the same dedicated account view in its idle probe.
Visible search readiness is required; an account URL alone is insufficient.
No login credentials, messages, templates, discounts or policy changes.

At 19:36:28 UTC both dedicated sessions were valid and health was AUTO/READY.
The new cycle completed at 19:36:03 UTC, reviewing eight delivery-reply cases
with zero new solutions/messages. Next run: 20:34:58 UTC, exactly one hour
after the last trigger. All seven cumulative runtime files matched their
manifests; environment, connections and unrelated containers were unchanged.

ES1478167 / issue 1373299 had already been resolved autonomously at 18:08 UTC
(19:08 Europe/Madrid), before this request. A fresh provider and ledger read
at 19:36:55 UTC independently verified the persisted note, 28 October afternoon
and the exact 16:00–19:00 preference. No solution was replayed; inactive old
issue 1371614 was ignored. Saved instructions do not prove physical delivery.

Validation: 408 source tests and 210 exact-image tests passed (overlapping
groups), zero failures/skips, without network or production credentials.
The guarded idle code-only rollback is prepared. Full sanitized receipt:
`docs/INCIDENT_HOURLY_DEPLOYMENT_20261026.json`.
Next: let the existing worker perform its hourly reviews; investigate only
new errors or cases requiring a human decision, preserving all claims/state.

## Purpose

This document lets Codex and the ChatGPT confirmation agent work from the same
repository context without sharing hidden memory, browser sessions or secrets.

GitHub is the durable coordination layer:

- repository files hold stable rules and implementation;
- the Agent Hub issue holds current work, findings and next actions;
- commits and pull requests hold proposed or implemented changes;
- Render and Supabase remain runtime systems, not agent-to-agent chat channels.

## Repository

- Name: `Suleia/suleia-autoconfirm`
- Default branch: `main`
- Production service: Suleia AutoConfirm on Render
- Runtime state: Supabase plus the service operational cache

Never place credentials or customer personal data in this document, issues,
commits or pull requests.

## Handoff format

```text
FROM: Codex | ChatGPT confirmation agent
STATUS: analysis | proposed | implemented | verified | blocked
SCOPE: <subsystem, files and anonymized order references>
SUMMARY: <what was learned or changed>
EVIDENCE: <tests, logs or links without secrets or personal data>
RISKS: <known risks or "none">
NEXT: <one concrete next action>
```

## Ownership rules

- An agent may analyze any repository code it can read.
- Only one agent should implement a given change at a time.
- Before editing, claim the work in the Agent Hub issue with `STATUS: proposed`.
- After publishing, post the commit or pull request and focused test result.
- The other agent reviews the evidence before starting overlapping work.
- User instructions always override an agent proposal.

## Production boundaries

- Reading production health and logs is allowed when authorized credentials are
  available.
- Real confirmation, cancellation, messaging and incident resolution are
  customer-impacting actions.
- Do not execute a customer-impacting action merely because another agent
  proposed it. Require the user's explicit authorization or an already-approved
  production automation rule.
- Do not alter Chatby templates or flows while investigating an unrelated
  problem.

## Instructions for the ChatGPT project

Add the GitHub app to the ChatGPT project and select
`Suleia/suleia-autoconfirm`. Start confirmation-agent tasks with:

```text
Use the connected GitHub repository Suleia/suleia-autoconfirm.
Read AGENTS.md, docs/AGENT_HANDOFF.md and the open Agent Hub issue first.
Follow their safety and handoff protocol. Do not expose secrets or customer
personal data. Do not modify production unless I explicitly authorize it.
```

When the ChatGPT agent finishes a task, it should write a handoff comment in
the Agent Hub issue. If its GitHub connection is read-only, it should return
the handoff block to the user for posting.

## Instructions for Codex

At the beginning of a coordinated task, read the latest Agent Hub comments.
At the end, post the implementation or verification result there. Keep detailed
customer data only in approved production systems and summarize evidence in
GitHub using anonymized references.

## Second-absence discount offer

Owner-authorized on 2026-10-01. Render's existing incident recovery scheduler offers the existing 5 EUR template once per order when:

- The current active pending issue is RECIPIENT_ABSENT with a verified second attempt (explicit attempt 2, or corroborated GLS ES code -30/14, substatus 15 and second-absence description). Queue counters alone are insufficient.
- The exact-order Chatby conversation contains a provider-verified dropea_ausente_v3 sent after order creation, at least 24 hours ago. A superseding absence does not reset this clock.
- No customer message, button or other inbound interaction occurred at or after v3. Uncertain history blocks sending.
- Fresh Dropea/order identity, exact Shopify order/amount, prior-return guard and persistent shared discount claim pass. A final conversation read after the claim blocks late replies.

No template/flow is modified. First/unknown absences cannot send. Existing rejection and address policies remain unchanged. The new lane does not authorize absent returns or apply an accepted discount financially. Existing global discount enable/real-send controls also govern this lane; rejection-specific switches only govern rejection offers.

## Reply-driven incident capabilities (2026-10-08)

Absence and address replies can use independently enabled `INCIDENT_E2E_<WORKFLOW>_<ACTION>_MODE=AUTO_CANARY` and `_BREAKER=CLOSED`. Supported absence actions are RETRY_DELIVERY, PICKUP_AT_AGENCY and REQUEST_RETURN. Address additionally supports PROVIDE_SOLUTION. The release gate `INCIDENT_REPLY_REGRESSION_GATE_REVISION` must equal the tested deployed commit. Defaults remain SHADOW.

The existing incident scheduler selects a current, unambiguous reply. A durable per-capability reservation permits one real canary, then promotes only after Dropea state verification. An uncertain result or interrupted reservation blocks that capability for reconciliation; it cannot resend. Existing address solutions retain their own verified canary controller and shared action ledger. Explicit client returns use the new response capability; silent returns retain their existing owners and deadlines.

PENDING_DATA is admitted only for the verified GLS Spain missing-data mapping. A street without a type prefix is accepted only when it matches the current order's original street; number, postal code and city remain required. Solutions preserve floor/door and instruct a telephone call before delivery. Later unresolved replies and expired delivery windows block execution. Template ownership and accepted-discount financial processing are unchanged.

## Independent evidence-backed retries (2026-10-13)

The dedicated VPS worker owns screenshot-backed retries for absent/rejected
incidents. It runs every 30 minutes (owner update 2026-10-14), shares the persistent incident claim and
requires exact-order replies, a one-hour settling window and fresh verification.
The owner authorized next business morning for an unconditional desire for the
order without any date/window preference. Explicit or earlier preferences take
precedence. A live retry with attached proof has been verified and the worker is
AUTO. Readiness, cycle history, durable pre-save journal and read-only outcome
feedback are private server state; vps_retry_feedback_v1 summarizes outcomes in
Supabase. Unknown writes are reconciled without resending.

Render retains address, template, discount and silent-return ownership. Address
details receipts can be reconciled from the exact outgoing Chatby WAMID and
attempt window without sending another message. A separately supplied postcode
retains a city only if the customer explicitly supplied it; portal/floor/door
must be preserved. Feedback does not automatically rewrite business rules.

Owner update 2026-10-14: the VPS systemd suleia-incidents.timer triggers the
authenticated all-incident sync endpoint every 30 minutes, with persistent
calendar scheduling and no HTTP mutation retries. INCIDENT_SYNC_OWNER=vps
disables Render's duplicate periodic incident timers; Render still executes
its governed address/data, notification, discount and return rules. Unknown
types are reviewed and remain blocked without a verified provider contract.
The independent browser worker processes eligible absent/rejected retries in
AUTO within a 20-minute admission budget; a canary or uncertain Save stops the
batch. Shared claims prevent duplicate actions between these execution paths.
The dashboard places customer activity, exact scoped text/button, timestamp
and verification state beside each order. An unavailable read is not silence.
