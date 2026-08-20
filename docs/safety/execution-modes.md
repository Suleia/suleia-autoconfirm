# Execution modes and write boundary

**Phase:** 0.5 — P0 containment
**Scope:** new Contabo / Operations / shadow architecture only
**Render legacy:** `FUNCTIONALLY_FROZEN`
**Deployment:** not performed

## Authority and separation

| Plane | Reference | Authority |
|---|---|---|
| Render legacy | `main@9569b01cc9af936bcf919dee5fe9f33d7151057d` | Existing production authority; unchanged |
| Contabo shadow | `deploy/contabo-operations-live@e17141edc87710c21dcf3c2292816a3f15218f12` plus this un-deployed branch | Read, project, simulate and compare only |

The new resolver is never imported by `autoconfirm/**`. It does not change the legacy agent's rules, prompts, timing, state, triggers, endpoints, clients or persistence.

## Canonical modes

```text
ExecutionMode = SIMULATION | READ_ONLY | PRODUCTION
```

| Mode | External effects | Executable decisions | Internal shadow persistence |
|---|---:|---:|---:|
| `SIMULATION` | forbidden | no | enumerated simulation/audit writes only |
| `READ_ONLY` | forbidden | no | projections, checkpoints, event/twin/read models and feedback only |
| `PRODUCTION` | not implemented; startup fails | no | not applicable |

`READ_ONLY` means zero mutating egress to production providers. It does not prohibit explicitly enumerated writes to Contabo's isolated PostgreSQL shadow database.

The canonical selector is `SULEIA_EXECUTION_MODE`. Absence defaults to `SIMULATION` (`DEFAULT_FAIL_CLOSED`). Legacy inputs remain compatible:

| Legacy input | Canonical result |
|---|---|
| `RUN_MODE=SIMULATION` | `SIMULATION` |
| `RUN_MODE=SHADOW_READ_ONLY` | `READ_ONLY` |
| `RUN_MODE=READ_ONLY` | `READ_ONLY` |
| Canonical and legacy disagree | abort |
| Unknown, empty or case-drifted value | abort |
| Legacy-only `PRODUCTION` | abort |
| Canonical `PRODUCTION` | `PRODUCTION_NOT_IMPLEMENTED`; abort |

Only exact `true` and `false` booleans are accepted. `NODE_ENV=production`, polling, cron or webhook flags never select production and never grant write authority.

## Capability flags

In either safe mode, any mutating flag set to `true` is a configuration contradiction:

```text
PRODUCTION_WRITES_ENABLED
REAL_DATA_WRITE_ENABLED
CONNECTOR_WRITE_ENABLED
ACTION_EXECUTOR_ENABLED
MCP_WRITE_TOOLS_ENABLED
DROPEA_WRITE_ENABLED
DROPEA_MUTATION_CLIENT_ENABLED
CHATBY_WRITE_ENABLED
GLS_WRITE_ENABLED
ISSUE_RESOLUTION_ENABLED
RETURN_EXECUTION_ENABLED
ADDRESS_UPDATE_ENABLED
CUSTOMER_MESSAGES_ENABLED
ORDER_CONFIRMATION_ENABLED
ORDER_CANCELLATION_ENABLED
RETURN_TO_ORIGIN_ENABLED
DISCOUNTS_ENABLED
TEMPLATE_SENDING_ENABLED
DISCOUNT_SENDING_ENABLED
EMAIL_SENDING_ENABLED
CHATBY_CONTACT_DELETE_ENABLED
RELEASIT_RETURN_BLOCK_WRITE_ENABLED
```

The resolver returns a deeply immutable, sanitized envelope and never returns raw environment values:

```json
{
  "mode": "READ_ONLY",
  "source": "CANONICAL",
  "production_writes": false,
  "external_writes_allowed": false,
  "decisions_executable": false,
  "fail_closed": true
}
```

Composition roots using it in this branch:

- `apps/api/server.mjs`;
- `packages/suleia-operations-mcp/src/config.mjs`;
- `packages/suleia-operations-mcp/src/shadow/config.mjs`;
- `services/process-runner.mjs`;
- `services/action-executor.mjs`.

Health, version and public configuration derive their observed mode from the same resolution.

## Execution Gateway

Every future external action must carry:

```text
action_id
order_id
action_type
idempotency_key
decision_id
state_version
input_hash
```

The Gateway derives and validates a canonical idempotency key from the semantic identity `(order, action type, state version, input hash)`. The generated `decision_id` is deliberately excluded so reevaluating the same state cannot create a second semantic action. A caller-selected key is rejected. The Gateway itself owns the claim; a caller cannot assert `idempotency_claim=CLAIMED`.

```text
Decision
  -> Conflict Check
  -> Policy Gate
  -> Execution Gateway
  -> adapter (absent in Phase 0.5)
```

Unknown or failed policy, database, credential, freshness, state-version or hash checks block. Even an all-PASS request is denied by execution mode and there is no external adapter.

Decision proposals and provider actions use separate vocabularies. The only mappings admitted in this phase are the explicit allowlist `PROPOSE_CONFIRM -> DROPEA_CONFIRM` and `PROPOSE_CANCEL -> DROPEA_CANCEL`; waiting, review and incident proposals are non-executable. Tests bind this mapping to a real `DeterministicDecisionEngine` decision rather than a fabricated provider action.

In Phase 0.5 the precondition context is still supplied by the caller and is therefore only a containment/test contract, not production authorization. Before any adapter or external capability, the Gateway must resolve the current decision, twin, policy, credentials and conflict state itself from authenticated authoritative dependencies (or verify an equivalent signed, opaque capability). A caller-supplied `PASS` must never be sufficient.

The in-memory ledger is a containment contract, not production-grade idempotency. Before any future external capability, it must be replaced by a durable transactional claim with crash/restart, concurrency, ambiguous-timeout and reconciliation tests.

## Snapshot and temporal safety

Each shadow decision now includes:

```text
decision_id
order_id
state_version
created_at
input_hash
policy_hash
```

The Digital Twin is deeply frozen. Its hash covers every snapshot field other than observation-only `built_at`, plus the complete policy snapshot. New valid events increment the per-order stream version. Invalid timestamps and events that claim to occur after receipt fail closed. A later stale fact blocks routing rather than becoming executable.

Freshness is evaluated by the decision engine against its active policy. The lower-level `isDecisionCurrent` helper requires the caller to supply the current policy explicitly and fails closed if it is absent. Any changed state, decision input or policy produces:

```text
decision stale -> reevaluate
```

This is shadow-only and does not change legacy interpretation.

## Scheduler safety

The new scheduler returns `SKIP_RETRY_SAFE` unless all of these are explicitly available/valid:

- Decision Engine;
- Policy Engine;
- API;
- database;
- configuration;
- state freshness;
- credential consistency;
- idempotency service;
- lock.

Even all-ready remains simulation-only. The existing legacy cron auth and scheduler topology are not changed by this branch.

## Supabase source identity

The deployed shadow currently receives a service-role credential. GET-only application code does not make that credential read-only.

This branch instead requires two distinct values:

```text
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # apikey header
SUPABASE_SHADOW_READER_TOKEN=<reader JWT>    # Authorization bearer
```

Local preflight rejects:

- any presence of `SUPABASE_SERVICE_ROLE_KEY`;
- `sb_secret_*` credentials;
- an opaque or malformed bearer;
- `service_role` or any role other than `suleia_shadow_reader`;
- an expired token;
- `alg=none`;
- an issuer other than the configured Supabase project.

Supabase remains responsible for signature validation. The repository includes non-executed design, verification and rollback SQL for an allowlisted `SELECT` role. No role, policy, token or production credential was created, changed or deployed in Phase 0.5.

The technical read-only gate remains `NO-GO` until the real role, RLS policies, grants, token signing/renewal and negative mutation tests are verified against Supabase without exposing data or secrets. If the reader fails, stop shadow ingestion; never reintroduce service-role as a fallback.

## Rollback

Because this branch is not deployed, rollback is deleting/reverting the branch commits. No external state or migration needs reconciliation.

For a future shadow-only rollout:

1. create and verify the technical reader under separate approval;
2. retain the prior image/configuration securely;
3. deploy only the shadow worker;
4. verify allowed reads and denied writes;
5. on failure, stop or revert the worker;
6. never mount service-role as a fallback;
7. leave Render unchanged.

## Gate status

| Gate | Status |
|---|---|
| New canonical modes fail closed | PASS in branch tests |
| New `PRODUCTION` mode impossible | PASS in branch tests |
| New external writes outside Gateway | none identified; static guard passes |
| New Gateway can execute externally | no; blocked and adapter absent |
| Snapshot/state stale detection | PASS in unit tests |
| Durable production idempotency | not implemented; required before any capability |
| Supabase permission-level read-only | not accredited; `NO-GO` |
| Legacy cron fail-open removed | no; frozen legacy P0 remains |
| Advance to Phase 1 | `NO-GO` |
