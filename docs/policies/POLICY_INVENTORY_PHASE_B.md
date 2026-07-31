# Phase B policy inventory

## Central simulation registry

The local Phase B registry contains current-order confirmation wait, disabled
commercial recovery candidate, AUSENTE/FALTAN_DATOS/NO_RESPUESTA incident
windows, UNKNOWN human review and one deprecated historic comparison policy.
Every entry has schema, version, status, priority, trigger, evidence,
prohibitions, timer, proposal, fallback, review conditions, owner, effective
range, rollback and change reason.

The registry is not wired into the production runtime. Invalid revisions are
rejected while the last valid version is retained. Production approval cannot
occur automatically.

## Dispersed references still requiring migration

| location | classification | meaning | Phase B disposition |
|---|---|---|---|
| `autoconfirm/render.yaml` | CONFIG_REFERENCE | Live unanswered-order threshold and incident timeout | Conflict recorded; unchanged |
| `autoconfirm/src/workflows/unanswered-cancellations.mjs` | ACTIVE_RUNTIME_REFERENCE | Current unanswered cancellation execution path | HIGH; current authority; unchanged |
| `autoconfirm/src/dashboard.mjs` and `autoconfirm/dashboard/main.js` | ACTIVE_RUNTIME_REFERENCE | Operational labels and explanations | Inventory only |
| `autoconfirm/src/workflows/telegram-agent.mjs` | ACTIVE_RUNTIME_REFERENCE | Operational command/report labels | Inventory only |
| `autoconfirm/src/clients/openai-assistant.mjs` | ACTIVE_RUNTIME_REFERENCE | Existing prompt text outside VPS Phase B | Inventory; no API call introduced |
| `packages/platform-core/src/decision-engine.mjs` | POLICY_REFERENCE | VPS deterministic defaults and deprecated comparison | Candidate for later integration |
| `packages/platform-core/fixtures/orders.json` | TEST_REFERENCE | Regression fixtures | Preserve |
| `docs/vps/*` and `docs/company/*` | DOCUMENTATION_REFERENCE | Historic decisions and current rules | Preserve as provenance |
| local uncommitted discount files | UNKNOWN/LOCAL_WORK_REFERENCE | Separate owner work | Explicitly excluded from Phase B |

No reference was automatically replaced. The current production system remains
authoritative. Before shadow mode, the owner must resolve the conflict between
the live unanswered-cancellation path and the VPS comparison-only position.
