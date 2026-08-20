# Phase 0.5 report — P0 containment

**Evidence cut:** 2026-08-20
**Overall result:** `NO-GO` for Phase 1
**Production deployment:** none

## Phase record

```text
PHASE: 0.5 — P0 CONTAINMENT
DEPLOY BRANCH: hardening/phase-0.5-p0-containment
LEGACY FREEZE BRANCH: hardening/phase-0.5a-confirmation-freeze
DEPLOY IMPLEMENTATION COMMIT: 46ef9e0
LEGACY FREEZE COMMIT: 6ea16b9
REPORT CLOSURE: this document's containing PR head
PRODUCTION IMPACT: none from this phase
CONFIRMATION AGENT BEHAVIOR CHANGED: NO
```

Two sub-branches are required because the production `main` history and the Contabo `deploy` history diverge. They were not mechanically merged.

## Baseline provenance

The requested clean baseline was repeated before implementation with the official portable Node runtime:

```text
Node: v22.22.0
npm: 10.9.4
pnpm used by the locked MCP package: 11.9.0
baseline date: 2026-08-19
```

| Clean snapshot | Result |
|---|---:|
| `main@9569b01cc9af936bcf919dee5fe9f33d7151057d` | `103/103` |
| `deploy@e17141edc87710c21dcf3c2292816a3f15218f12` | `420/420` |
| `platform-core` at the deploy snapshot | `152/152` |

All pre-change baselines passed, so the stop condition was not triggered.

## Files changed

### Main-based functional freeze sub-branch

- `.gitignore`, additive exclusions for generated runtime state below `autoconfirm/data/`;
- `docs/safety/CONFIRMATION_AGENT_BASELINE.md`;
- `autoconfirm/tests/regression/confirmation-agent/**`;
- `autoconfirm/package.json`, additive regression-test script only.

No production module under `autoconfirm/src/**`, server, client, workflow, prompt, timer, endpoint, Dockerfile, persistence implementation or Render manifest was modified.

Review detected a generated, untracked `autoconfirm/data/stores.json`. It was absent from `main@9569b01`, was never an authorized Phase 0.5 change and was removed before final status validation. Final checks confirm that it is absent and not tracked. Additive ignore rules and a regression gate now prevent the generated runtime state files from being committed or staged.

### Deploy-based containment branch

- `.env.vps.example`;
- `apps/api/server.mjs` and `apps/api/server.test.mjs`;
- `docs/safety/execution-modes.md`;
- `docs/safety/WRITE_PATH_INVENTORY.md`;
- `docs/incidents/PHASE_0_5_REPORT.md`;
- `infrastructure/docker/compose.yaml`;
- `infrastructure/scripts/inventory-supabase-safe.mjs`;
- `infrastructure/scripts/inventory-supabase-safe.ps1`;
- `infrastructure/scripts/inventory-supabase-safe.test.mjs`;
- `infrastructure/scripts/provision-shadow-source-secrets.ps1`;
- `infrastructure/scripts/provision-shadow-source-secrets.test.mjs`;
- `infrastructure/scripts/validate_staging_safety.mjs`;
- `infrastructure/supabase/shadow-reader-role.sql`;
- `infrastructure/supabase/verify-shadow-reader-role.sql`;
- `infrastructure/supabase/rollback-shadow-reader-role.sql`;
- `infrastructure/supabase/shadow-reader-role.test.mjs`;
- `infrastructure/vps/deploy-shadow-readonly.sh` and its test;
- `packages/platform-core/fixtures/orders.json`;
- `packages/platform-core/src/decision-engine.mjs`;
- `packages/platform-core/src/digital-twin.mjs`;
- `packages/platform-core/src/event-store.mjs`;
- `packages/platform-core/src/execution-mode.mjs`;
- `packages/platform-core/src/execution-gateway.mjs`;
- `packages/platform-core/src/scheduler-safety.mjs`;
- focused `platform-core` tests and golden assertions;
- `packages/suleia-operations-mcp/src/config.mjs`;
- `packages/suleia-operations-mcp/src/shadow/config.mjs`;
- `packages/suleia-operations-mcp/src/shadow/source.mjs`;
- `packages/suleia-operations-mcp/src/shadow/source-credential.mjs`;
- focused MCP shadow credential/read-only tests;
- `services/action-executor.mjs` and its additive contract test;
- `services/process-runner.mjs` and its contract test.

## What was implemented

### 1. Functional freeze and regression contract

The production acceptance/confirmation agent is documented as `FUNCTIONALLY_FROZEN` at `main@9569b01`.

The dedicated regression contract:

- uses synthetic identifiers and messages;
- redirects state to temporary storage;
- blocks every unmocked network call;
- captures current intent, current-order association, one-hour delay, reread, regret, promotion change, address hold, Shopify behavior and unanswered-order behavior;
- validates exact Git blob identity for 46 critical production files;
- permits only the additive regression command in `autoconfirm/package.json`.

The frozen production diff is:

```text
confirmation agent critical files changed: 0/46
confirmation behavior changes: 0
confirmation rule changes: 0
confirmation timing changes: 0
```

This evidence is conditional on committing only the allowlisted ignore rules, documentation, regression tests and additive package script. Any staged or committed runtime configuration, including `autoconfirm/data/stores.json`, invalidates the freeze and is a hard `NO-GO`.

### 2. Canonical execution mode for the new architecture

`ExecutionModeResolver` normalizes new-platform inputs to:

```text
SIMULATION | READ_ONLY | PRODUCTION
```

For Phase 0.5:

- absent mode defaults to `SIMULATION`;
- invalid booleans or unknown modes abort;
- contradictory canonical/legacy inputs abort;
- any mutating capability in a safe mode aborts;
- `PRODUCTION` is explicitly not implemented;
- no environment, polling, webhook or cron flag can infer write authority.

The resolver is used only by the Contabo/API/MCP/process-runner composition roots. It is not imported by `autoconfirm/**`.

### 3. New write boundary

The additive `ExecutionGateway` requires:

```text
action_id
order_id
action_type
idempotency_key
decision_id
state_version
input_hash
```

It derives the canonical idempotency key from the semantic action identity, rejects caller-selected alternatives, checks the current decision/state/hash and blocks on unknown conflict, policy, DB, credential or freshness state.

There is no external adapter. Even an all-PASS request is rejected by execution mode. Existing exports of the disabled Action Executor preserve their previous public behavior.

### 4. Scheduler fail-safe for new components

The new scheduler contract returns `SKIP_RETRY_SAFE` unless Decision Engine, Policy Engine, API, DB, config, freshness, credentials, idempotency and lock are all explicitly ready. An all-ready result remains simulation-only.

This does not change or repair the legacy cron topology.

### 5. Temporal precedence and decision snapshot in shadow

Shadow decisions now carry:

```text
decision_id
order_id
state_version
created_at
input_hash
policy_hash
```

The Digital Twin is deeply frozen. Event stream versions are monotonic; invalid temporal claims fail closed; changed state, input or policy makes a prior decision stale and forces reevaluation.

These protections are not connected to real confirmation execution.

### 6. Supabase reader design and local gate

The proposed shadow artifacts no longer accept a service-role secret. They require a separate publishable key plus a JWT whose declared role is `suleia_shadow_reader`, with strict local checks for type, role, issuer, algorithm and expiry.

The repository also contains design, verification and rollback SQL for allowlisted `SELECT` access.

No Supabase role, grant, RLS policy, key or token was created or applied. Local JWT inspection is not proof of provider-side least privilege or signature validity.

### 7. Write-path inventory

All identified paths are classified as:

```text
LEGACY_APPROVED
NEW_GATEWAY
UNSAFE_BYPASS
UNKNOWN
```

The new-architecture safety scan reports zero imports of production mutation clients. Existing legacy bypasses are documented, not silently reclassified as safe.

## What was not touched

- Render production source or deployment;
- confirmation/cancellation rules, prompts, timers, triggers or endpoints;
- one-hour confirmation wait or reread behavior;
- Chatby templates, flows, contacts or customer conversations;
- Dropea orders, incidences or actions;
- GLS shipments or actions;
- Shopify configuration or orders;
- live cron callers or secrets;
- live Supabase roles, policies or credentials;
- database schemas or migrations in a running environment;
- Contabo containers or host release;
- production state files.

The generated `autoconfirm/data/stores.json` found during review was removed and final status confirms it is absent and untracked.

Phase 1 was not started.

## Final tests

All final suites were executed under Node 22.22.0.

| Scope | Result |
|---|---:|
| Deploy branch complete suite | `494/494` |
| Main-based generic suite after additive regression work | `136/136` |
| Dedicated confirmation-agent regression contract | `52/52` |
| Frozen critical-file comparison | `46/46` unchanged |

Tests used fixtures, mocks and blocked egress. They did not use real customers or invoke provider mutations.

## Legacy and production impact

```text
legacy behavior changes: 0
confirmation logic changes: 0
confirmation timing changes: 0
confirmation trigger changes: 0

production deployments initiated by Phase 0.5: 0
database migrations applied: 0
credentials created, rotated or removed: 0

new production writes: 0
external provider mutations from tests/work: 0
real customer test messages: 0
real Dropea test actions: 0
real GLS test actions: 0
real Shopify test actions: 0
```

The legacy production automation was not stopped. Any normal legacy action occurring independently is outside the Phase 0.5 test activity and remains governed by the existing production rules.

## Open risks and blockers

### B-01 — Cron authorization is live fail-open

`isAuthorizedCron` accepts a request when `CRON_SECRET` is absent. Secret-safe live presence evidence confirms that this secret is currently absent. Cron endpoints can initiate confirmation, cancellation or messaging workflows.

Changing only server code would stop active callers. Closure requires an atomic, separately authorized secret-and-caller rollout plus negative authentication tests.

### B-02 — Telegram webhook is live fail-open

The webhook accepts a missing `TELEGRAM_WEBHOOK_SECRET`, and an authorized-looking payload can reach the unanswered cancellation sweep. Secret-safe live presence evidence confirms that this secret is currently absent.

### B-03 — Dashboard action auth inherits cron fallback

The manual Dropea cancellation endpoint accepts dashboard authentication or cron authorization. The missing cron secret therefore expands the affected surface.

### B-04 — Supabase technical read-only is not accredited

The currently deployed shadow still has the existing service-role configuration because this branch was not deployed. The proposed reader role/token exists only as code and SQL design. Required evidence still includes:

- provider-side role and RLS grants;
- Supabase signature validation;
- allowed GETs;
- denied POST/PATCH/DELETE/RPC mutations;
- secret-safe logs showing zero writes.

### B-05 — Idempotency is not durable

The Gateway owns a canonical in-memory claim, but has no transactional persistent ledger, crash/restart recovery, ambiguous-commit state or reconciliation worker.

### B-06 — Gateway preconditions are not yet authoritative

Gateway preconditions are still passed in by the caller. They are useful for a hard-disabled contract test, but are not authoritative production evidence. Before any capability, the Gateway must load or cryptographically verify the current decision, twin, policy, credential and conflict state itself; a caller-fabricated `PASS` must remain ineffective.

### B-07 — No external adapter exists

The absence of an adapter is an intentional safety control in Phase 0.5. It also means the future execution pipeline is incomplete and must remain non-production.

### B-08 — Production/runtime divergence remains

The production Dockerfile remains on Node 20 while validation uses Node 22.22. Phase 0.5 does not change that runtime. The `main` and `deploy` histories also remain separate and require controlled integration rather than a mechanical merge.

## Rollback

Because nothing was deployed or migrated:

1. revert the eventual deploy-branch containment commit;
2. revert the additive main freeze/regression commit if required;
3. no external provider or database reconciliation is necessary;
4. no customer communication requires recall;
5. no production action requires compensation.

For a future Supabase reader rollout, rollback means stopping or reverting only the shadow worker. Service-role must not be reintroduced as a shadow fallback. Render remains untouched.

## Phase 0.5 gates

| Required gate | Result | Evidence / reason |
|---|---|---|
| Node 22.22 baseline | `PASS` | `103/103`, `420/420`, `152/152` before changes |
| Confirmation regression suite | `PASS` | `52/52` dedicated; `136/136` generic |
| Confirmation behavior identical | `PASS` for the allowlisted intended diff | 46 critical blobs unchanged; behavior/rule/timing diff `0`; generated runtime config is absent/untracked and the hard pre-commit gate remains |
| Production writes during tests | `PASS` | `0` initiated by Phase 0.5 |
| External customer messages | `PASS` | `0` |
| New execution mode fail-closed | `PASS` in branch | Final deploy suite `494/494` |
| Shadow technical write capability removed or blocked | `NO-GO` | Proposed artifacts reject service-role, but real reader/RLS/negative mutation proof is absent and no deployment occurred |
| Unsafe new write bypasses | `PASS` | `0` direct production-client imports found in new architecture |
| Critical cron fail-open paths corrected | `FAIL` | Cron and Telegram fail-open remain active |
| New infrastructure simulation/read-only | `PASS` in branch | Production mode unavailable; executor blocked; no adapter |
| Minimum idempotency for new Phase 0.5 actions | `PASS` for containment | Canonical Gateway-owned key; replay blocked in process; external execution hard-disabled |
| Rollback documented | `PASS` | Branch-only revert and future reader rollback recorded |

Future production execution has stricter, later-phase gates that do not block development of the read-only Phase 1 State Builder: durable transactional idempotency/reconciliation, authoritative Gateway precondition resolution, and mock-only adapters with production disabled. None is authorized as an external capability by this report.

## Decision

```text
GO Phase 0.5 branch for review: YES
GO deploy Phase 0.5 to production: NO
GO Phase 1: NO
```

Phase 1 must not start until, at minimum:

1. cron and Telegram authentication are made fail-closed through a coordinated rollout without changing business rules or timing;
2. a real Supabase `SELECT`-only identity is provisioned and proven with negative mutation tests;
3. both branch commits and their exact test evidence are published for review.

Separately, before Phase 7 or any external execution capability:

1. replace in-memory idempotency with a durable transactional claim and reconciliation;
2. obtain Gateway preconditions from authenticated authoritative dependencies, not caller assertions;
3. keep every adapter mock/simulation-only with no production credential until a later explicit authorization.

No remediation may alter the frozen confirmation agent without separate explicit authorization and a renewed regression contract.
