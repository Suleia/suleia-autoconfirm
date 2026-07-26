# Risk and QA gates

## Automatic blockers

A decision is routed to `BLOCKED` when any of these conditions is true:

- required evidence is stale;
- source data contradicts another authoritative source;
- the same action was already proposed or recorded;
- order identity is incomplete;
- a later customer message reverses an earlier confirmation;
- the policy version is missing;
- the requested action is not permitted in simulation.

## Human review

`HUMAN_REVIEW` is required for:

- conflicting but potentially resolvable evidence;
- business exceptions;
- uncertain identity matching;
- customer-impacting ambiguity;
- any future write action until separately authorized.

## Interactive review

`AI_REVIEW` may summarize masked evidence and compare alternatives. It cannot call an external LLM in this phase and cannot execute actions.

## Release gates

1. Static safety validation passes.
2. All fictitious scenarios return `actions_executed = 0`.
3. Existing confirmation regression tests pass.
4. MCP schemas and authentication tests pass.
5. Docker Compose starts on an isolated host.
6. PostgreSQL migrations and rollback are tested.
7. Backup restore is verified.
8. One masked order rehearsal is explicitly authorized.
9. Private staging is approved before any public staging.
10. Production cutover requires a separate explicit authorization.
