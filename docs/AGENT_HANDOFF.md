# Suleia agent handoff

Updated: 2026-07-25

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

## Budget Autopilot V5.1 SHADOW deployment (2026-10-22)

### Later state / V6 development (2026-10-23)

The owner subsequently approved guarded V5.1 LIVE; the captured production API
revision is e4d3b9d and the current development base is b9e8e4b (PR134). Preserve
that existing policy and executor. See `ADS_INTELLIGENCE_V6.md` and
`ADS_INTELLIGENCE_V6_AUDIT.md` for the V6 development implementation, aggregate
read-only audit, 298-test Node22/PostgreSQL validation, local fixture screenshots,
and release/rollback plan. V6 is not merged/deployed; its flag defaults off, and
its review service has no budget writer, message sender or scheduler. No new
production tasks or notifications are authorized. The SHADOW paragraph below
describes the earlier historical deployment, not the current LIVE state.

See `META_BUDGET_AUTOPILOT_V5_1.md`. This branch implements fixed EUR 10 candidates,
EUR 70 cap, Madrid slots and progressive night caps through the existing executor.
The owner separately approved SHADOW deployment, migration 058 and scheduled SHADOW
reviews, including simulation of previously LIVE confirmed manual budget orders.
API code 5177e53 is healthy; the panel and existing single bot are deployed. Limited
SQL grants and both actors' signed access are verified. Automatic LIVE remains
compiled false, all Meta writes and new Autopilot reports are off. The cold learning
read is bounded and pending evidence blocks changes. Final Node 22 suite passed 360
tests; the unchanged migration passed its isolated PostgreSQL integration.
At 12:09 Madrid the next slot is 13:00; none had yet been due since activation.
Do not claim that first cycle completed or replay 12:00. Keep legacy risk limits
blocking until consolidated policy approval; do not invent minima, global limits
or incremental evidence. The report contains actual deployment and rollback paths.

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
