# Suleia agent handoff

## 2026-10-26 · Renewed-absence notices deployed and real send verified (PR163)

The owner explicitly requested the approved es_ES dropea_ausente_v3 for the
new ES1476535 absence and future equivalents. Existing controller d64bb5b was
healthy but intentionally capped each order at two notices. Current issue1373739
is a distinct later active/current provider failure; the two22October notices
remain independently VERIFIED. Latest earlier delivery selection was23October
afternoon and cannot authorize today's reschedule.

Runtime ea94913105d47bdd4006a6cd1d23c5b0be929705 is LIVE and healthy, image40963cb6...
on the same recipient-absent-live-controller. Four overlaid module hashes match
the tested artifact. New repeated_absence_notice_authorized evidence flag enables
only later successors. Initial/second controls, body/buttons/native destinations,
configuration/sandbox/networks, other services, timers and discounts are preserved.
Each successor requires the complete verified predecessor chain, fresh exact-order
conversation and distinct later primary failed-attempt issue. Atomic latest/count
reservation and post-claim reread retain duplicate/uncertainty/contrary-intent guards.
Notice sequence is not a fabricated carrier attempt number. No new scheduler.

Tests:279 focused Linux/Node22 regressions and one isolated PostgreSQL17 integration
test pass with no production credentials/network. The latter races20 competitors,
rejects uncertain/obsolete predecessors, verifies third/fourth notices and all
earlier bounded receipts, and retains the exact initial timer. Separate synthetic
one-vs-four v3 check retains the original first-notice discount clock. Actual base
hash comparison identified only CRLF/LF differences, verified before rollout.

ES1476535/1373739: one bounded invocation of the identical existing selector and
executor, with no independent sender or bypass, received ACKNOWLEDGED. Independent
Chatby history subsequently supplied the definitive WhatsApp WAMID: sent26October
18:53:49UTC, receipt VERIFIED18:55:36.715UTC. Recheck returned ALREADY_CLAIMED_NO_POST.
All three order receipts remain VERIFIED; zero duplicate issue/template claims,
zero timers for the new issue, every original timer retained. No physical delivery
or incident solution claimed from the message alone.

Existing solution worker remains AUTO/READY with its30minute schedule. Fresh
18:56UTC read shows current issue PENDING/active and NO_CURRENT_DELIVERY_REPLY:
await a new date/window, then let that owner apply the normal settling/freshness
and cancellation checks before supplying the solution. Do not reuse23October or
replay the solution already saved for the distinct older issue1371043.

Receipt: docs/ABSENCE_NOTICE_PER_ATTEMPT_DEPLOYMENT_20261026.json; rule/rollback:
docs/ABSENCE_NOTICE_PER_ATTEMPT.md. Root-owned disable.py is installed and syntax
checked: disable only the new flag, preserve all claims and the compatible verifier;
do not restore old database state or an observer that cannot distinguish successors.
NEXT: existing controller and solution worker continue naturally; independently
verify any new current customer selection and never resend an uncertain claim.

Updated: 2026-07-25

## Purpose

This document lets Codex and the ChatGPT confirmation agent work from the same
repository context without sharing hidden memory, browser sessions or secrets.

GitHub is the durable coordination layer:

- repository files hold stable rules and implementation;
- the Agent Hub issue holds current work, findings and next actions;
- commits and pull requests hold proposed or implemented changes;
- Render and Supabase remain runtime systems, not agent-to-agent chat channels.

Owner update 2026-10-22: a new, verified second failed delivery attempt may
receive one separate absence notice using the existing controller and approved
v3 template. This narrowly replaces the blanket one-absence-notice-per-order
rule; other lifecycle templates retain their rules. See SECOND_ABSENCE_NOTICE.md
for the durable two-stage claim, fresh receipt checks and flag-only rollback.

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

## 2026-09-23 — Incident customer activity display

Incident evidence must distinguish an exact-order inbound event after issue creation from a notification-bound actionable response. The private display query now selects the latest post-opening inbound message for the exact issue and order. Unverified notification anchoring keeps automatic decisions blocked, but no longer hides the observed text/button or its timestamp. The dashboard customer-response flow includes observed interactions. Incident history reads include bot messages and use the provider timestamp cursor for all incident types; order confirmation readers are unchanged.

Regression coverage includes missing notification, text/button observations, prior/future/lifecycle messages, missing identity, stale reads, retained action guards, history pagination and safe DOM rendering. Production verification must check the two reported orders through the same repository projection as the panel without logging customer content.

## 2026-09-26 — ADDRESS canonical integrity

Governed normalization is scoped to GLS ES, code -30, substatus 13, raw ADDRESS_INCORRECT and corroborating description. The generic -30 registry is not an address mapping. Migration 050 registers both address policies, retains invalid legacy timer history and materializes immutable owner-evidence snapshots. The canonical response timer uses issue + notification message hash + response policy; provider updates never renew it. The current-context view verifies issue version, owner evidence, policy and freshness; historical decisions cannot be current.

The provider conflict remains manual and excluded from canaries. RETURN remains SHADOW with breaker OPEN; no new provider actions, messages or emails are authorized by this correction. Accepted discounts remain manual. Backend evidence metadata is deployed independently from the VPS read-side; do not deploy the monorepo's older autoconfirm tree to Render.
