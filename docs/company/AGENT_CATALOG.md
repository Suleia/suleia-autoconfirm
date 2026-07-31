# Deterministic agent catalog

## Meaning of agent

An agent is a deterministic contract, not an LLM process. The canonical catalog
derives exactly one primary agent from each of the 40 department contracts.

Every agent declares:

- stable agent and department identifiers;
- deterministic purpose, inputs and outputs;
- allowed and forbidden operations;
- simulation-only run mode;
- audit requirement;
- schema version;
- explicit denial of execution, production writes and external AI.

## Allowed operations

```text
READ_MASKED_DATA
EVALUATE_RULES
PROPOSE_DECISION
SIMULATE
CREATE_REVIEW_REQUEST
EMIT_AUDIT_EVENT
```

## Forbidden operations

```text
EXECUTE_ACTION
WRITE_PRODUCTION
SEND_CUSTOMER_MESSAGE
APPLY_DISCOUNT
CONFIRM_ORDER
CANCEL_ORDER
RETURN_ORDER
CALL_EXTERNAL_AI
CALL_OPENAI_API
MODIFY_POLICY
```

## Input boundary

Phase A contracts reference masked events, the Order Digital Twin, a versioned
policy and source freshness. They do not receive raw secrets, arbitrary SQL,
arbitrary URLs, shell commands or unrestricted customer data.

## Output boundary

Outputs are typed proposals, assessments, metrics, alerts, review requests and
status read models. An output is never evidence that an external action ran.
`actions_executed` and `production_writes` remain zero.
