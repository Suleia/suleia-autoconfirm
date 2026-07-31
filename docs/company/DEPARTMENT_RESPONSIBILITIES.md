# Department responsibilities

## Executive control

The five executive offices consolidate snapshots for operations, intelligence,
risk/compliance, economics and platform/migration. Their outputs are read models
such as `executive_snapshot`, `risk_summary` and `migration_summary`. They do not
authorize or execute customer-impacting actions.

## Operations

- Order Confirmation preserves current-order evidence, the one-hour wait and
  the later-change-of-mind blocker.
- Cancellation distinguishes explicit cancellation, unanswered cases and
  logistics returns.
- Incident Management normalizes incidents and preserves the 48-hour window.
- Logistics evaluates current carrier evidence without acting.
- Customer Recovery evaluates commercial recovery while discounts remain off.
- Agency Pickup requires current carrier evidence and makes no unsupported
  promises.
- Address Resolution detects missing or contradictory address evidence.
- Human Review owns ambiguous and HIGH-risk cases and records decisions.

## Intelligence

Operational Intelligence, Pattern Detection, Forecasting, Policy Simulation,
Learning from Human Decisions, Data Quality Intelligence and Strategic
Reporting use SQL, local statistics and deterministic rules only. Human
decisions may generate proposals; they never retrain or rewrite policy.

## Governance

Policy Engine, Risk Engine, QA Gate, Compliance Engine, Authorization Gateway
and Audit & Reconciliation form the control chain. In Phase A these are
contracts only. Existing runtime gates remain authoritative until Phase B is
approved.

## Economic

Unit Economics, Recovery Economics, Delivery Cost Analysis, Discount Impact
Analysis and Margin Protection calculate impact only. No economic result can
authorize a discount, confirmation, cancellation or return.

## Platform

Event Fabric, Digital Twin, Timer Engine, PostgreSQL, MCP, Connectors,
Observability, Backup & Restore and Migration Control own shared technical
capabilities. MCP remains read-only; connectors remain non-writing in this
checkpoint; PostgreSQL and Docker remain private.
