# Suleia operating model

## Purpose

Suleia Autonomous Operations Company is the organizational view of the existing
deterministic logistics platform. It does not represent independent AI models or
autonomous production actors. A Suleia agent is a versioned rule-processing
contract inside a modular monolith.

Phase A is behavior-neutral. It creates names, ownership, responsibilities,
inputs, outputs and prohibitions without wiring any new runtime path.

## Operating principles

1. Facts, interpretation, policy, decision, authorization, execution,
   verification and reconciliation remain separate stages.
2. Events are append-only; corrections supersede rather than erase history.
3. Policies are versioned and future promotion requires an explicit gate.
4. Deterministic agents may read masked data, evaluate, simulate, propose and
   escalate. They cannot execute actions.
5. Uncertainty fails closed: MEDIUM requires QA, HIGH requires human review and
   CRITICAL blocks.
6. The VPS never calls OpenAI or another external model. ChatGPT may query the
   private read-only MCP interactively.
7. PostgreSQL, Event Store, Digital Twin, timers and MCP remain shared platform
   capabilities; departments are modules, not unnecessary microservices.

## Permanent Phase A invariants

```text
OPENAI_API_CALLS=0
OPENAI_API_COST=0_EUR
EXTERNAL_AI_CALLS=0
ACTIONS_EXECUTED=0
PRODUCTION_WRITES=0
MESSAGES_SENT=0
DISCOUNTS_APPLIED=0
```

## Decision authority

Executive offices consolidate information but never act. Operations modules
produce candidates. Governance evaluates policy, risk, QA and compliance.
Economic modules calculate impact but never authorize. The platform layer
provides deterministic infrastructure. Any future executor remains a separate,
disabled boundary and is outside Phase A.
