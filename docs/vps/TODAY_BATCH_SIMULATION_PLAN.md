# Today real masked simulation plan

Date: 2026-07-27

Business timezone: `Europe/Madrid`

Status: implemented; real batch aborted at the mandatory preview gate.

## Scope

The batch is restricted to orders satisfying:

```text
created_at >= 2026-07-26T22:00:00.000Z
created_at <  2026-07-27T22:00:00.000Z
```

The pipeline reads source records ephemerally, validates and masks them in
memory, creates an Event Store and Digital Twin, evaluates timers and the
deterministic Decision Engine, compares with the current system and persists
only the masked report.

## Safety gates

- Only `GET` and `HEAD` are accepted by the connector transport.
- `POST`, `PUT`, `PATCH` and `DELETE` fail before network access.
- Production writes, Action Executor, MCP write tools, live jobs and external
  AI are disabled.
- Raw source payloads are never persisted.
- Direct PII is rejected before a report can be written.
- Missing or incomplete authoritative sources make the batch incomplete and
  block dependent decisions.
- Every simulated order and batch must report `actions_executed=0`.

## Execution sequence

1. Run unit, connector, timezone, pagination, masking and zero-action tests.
2. Validate the staging safety configuration and database isolation.
3. Calculate the exact Europe/Madrid business-day boundaries.
4. Run a non-persistent source preview.
5. Persist the masked simulation only if Shopify pagination is complete and
   the remaining source limitations are explicitly represented.

Step 4 stopped with `SHOPIFY_GET_CREDENTIALS_MISSING`, so step 5 was not run.
