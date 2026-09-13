# Meta Ads budget control — simulation/shadow boundary

## Status

`META_BUDGET_POLICY_V1` is implemented for `SIMULATION` and `SHADOW` only.
`APPROVAL_REQUIRED` and `LIVE` are declared future modes and fail configuration.
The production writer is not compiled and every `executeChange` call returns
`BLOCKED_BY_SIMULATION_MODE` before any HTTP request can be created.

Invariant for this phase:

```text
actions_executed=0
production_writes=0
meta_budget_writes=0
external_actions=0
telegram_sends=0
```

## Reused read path

The existing `services/meta-ads` reader remains the only Meta connector. It:

- uses an HTTPS allowlist and GET-only transport;
- validates `ads_read`, active account, EUR and `Europe/Madrid`;
- discovers active campaigns and CBO/ABO budget owners;
- reads campaign insights for the Madrid business date;
- extracts only purchase ROAS and purchase conversion metrics;
- has no budget mutation or Telegram send method.

## Isolated decision path

```text
Meta GET-only reader
  -> metrics normalizer/freshness
  -> META_BUDGET_POLICY_V1
  -> guardrails
  -> hourly idempotent decision
  -> internal simulation state + audit history
  -> authenticated read-only Operations API
```

No order confirmation, cancellation, Dropea, Chatby, incident, GLS or operational
policy code is imported by this subsystem.

## Canonical policy V1

- Currency: EUR.
- Business timezone: Europe/Madrid.
- Evaluation key: campaign + UTC hour + policy version. The business rule is
  evaluated after conversion to Madrid time; using a UTC hour key also keeps the
  repeated DST hour idempotent without collapsing two real hours.
- Minimum daily campaign budget: 1,500 cents.
- Maximum daily campaign budget: 7,000 cents.
- Night: 00:00–06:59 Madrid; no ROAS scaling.
- Night cap: 3,500 cents.
- Day: from 07:00 Madrid.
- Purchase ROAS strictly greater than 6: add 1,000 cents, capped at 7,000.
- Purchase ROAS exactly 6 or between 3 and 6: hold.
- Purchase ROAS below 3: hold; no reduction policy exists.
- Missing/malformed ROAS: hold as unavailable, never coerce to zero.
- Only `FRESH` metrics can produce an increase.
- ABO: `SIMULATION_ONLY_REVIEW`; no ad-set allocation is invented.

Budget arithmetic is integer cents. ROAS thresholds are compared as decimal
rationals rather than binary floating-point values.

## Real versus simulated budget

`actual_meta_budget_cents` is the last value read from Meta. It is never changed.
`simulated_budget_cents` is an internal policy state. A 15 EUR real budget can
therefore simulate 25, 35 and 45 EUR over three consecutive eligible hours while
the real Meta budget remains 15 EUR.

`resetSimulationToMetaBudget` resets only the internal state and creates an
internal audit record. It is not exposed as an HTTP or MCP write operation.

## Persistence

Migration `034_meta_budget_simulation.sql` creates:

- `economics.meta_budget_decisions`: immutable hourly decision records;
- `economics.meta_budget_simulated_state`: current sequential simulation state;
- `economics.meta_budget_simulation_resets`: internal reset audit;
- `read_models.meta_budget_decision_history`: read-only history;
- `read_models.meta_budget_simulation_latest`: read-only current debug view.

Database constraints force `executed=false`, `meta_write_attempted=false` and all
external/production/Meta write counters to zero. The public MCP database role is
explicitly denied. The Operations API role receives SELECT only.

## Read-only inspection

All endpoints require the existing Operations OAuth authentication:

- `GET /api/operations/meta-budget/policy`
- `GET /api/operations/meta-budget/simulation?limit=100`
- `GET /api/operations/meta-budget/history?campaign_id=...&limit=250`

Responses state `SIMULATION - NO REAL CHANGES` and include zero write counters.
Future MCP read interface names exist only as an unregistered service contract;
the public MCP catalog is unchanged and no Meta write tool exists.

## Execution and scheduling

The compose profile `meta-budget-shadow` is a one-shot manual runner. It reads Meta
and persists internal decisions only. This change intentionally creates no timer,
cron entry or always-on loop. An hourly scheduler can invoke the one-shot runner in
a later, separately authorised deployment; duplicate calls in one hour are safe.

## Backtest

The pure backtest accepts historical normalized metric rows, applies the same
policy and returns would-increase, hold, night-cap and review counts plus the
campaign-by-campaign simulated sequence. It labels results
`SIMULATED_NOT_CAUSAL`. When no adequate history is supplied it reports
`INSUFFICIENT_DATA` instead of inventing results.

## Future gates

`APPROVAL_REQUIRED` would require a new approved policy version, durable approval
identity/expiry/replay protection, and a reviewed write credential boundary.

`LIVE` would additionally require an intentionally compiled writer, least-privilege
Meta credential in trusted secret storage, explicit enablement of every kill switch,
campaign/budget/freshness revalidation immediately before mutation, canary rollout,
reconciliation, rollback and separate production authorisation. None is enabled now.
