# Organizational architecture

## Structure

The source of truth is
`packages/platform-core/src/organization/catalog.mjs`. It contains six layers,
40 departments and one deterministic primary agent per department.

```text
Suleia Operating System
|- Executive Control (5 offices)
|- Operations (8 departments)
|- Intelligence (7 departments)
|- Governance (6 departments)
|- Economic (5 departments)
`- Platform (9 departments)
```

## Architectural boundary

The organization is a logical modular monolith. Departments own contracts and
responsibilities, not containers, databases or credentials. Separation into a
new process requires measured contention, isolation or scaling evidence plus a
recorded architecture decision.

## Direction and accountability

- Chief Operations Office owns operational flow and human-review load.
- Chief Intelligence Office owns deterministic metrics and recommendations.
- Chief Risk & Compliance Office owns policy, risk, QA and compliance gates.
- Chief Financial Operations Office owns informative economic calculations.
- Chief Platform Office owns health, persistence, security and migration.

No executive office imports or invokes the Action Executor.

## Contract lifecycle

Phase A contracts have status `CONTRACT_ONLY`. Later phases may implement them
behind simulation flags, but may not silently change their prohibitions. A
contract change requires tests, a decision-log entry and an Agent Hub handoff.
