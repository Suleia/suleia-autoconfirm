# Current status

Updated: 2026-07-31

The private Contabo staging platform is deployed and healthy. Its services are
private, PostgreSQL is not exposed and all simulations remain zero-action.

The read-only daily-order pipeline, Europe/Madrid date boundaries, pagination,
PII masking, Event Store, Digital Twin, timers, deterministic simulation and
current-system comparison are implemented and tested.

The 2026-07-28 real-data checkpoint recovered the existing Shopify application
credentials securely, issued an ephemeral token in memory and processed all 12
orders created inside the exact Europe/Madrid business-day interval.

All 12 orders were masked and simulated. Authorized semantic reads made
Dropea, GLS and the current-system cache consultable. GLS returned five
complete tracking records; exact technical references enabled three partial
current-system comparisons, while nine remained without sufficient exact
identity evidence.

The batch remains `INCOMPLETE` with every route blocked because the
current-system cache is non-authoritative for completeness. The updated masked
report is stored privately on the VPS with mode `0600`.

Current safety result:

```text
ACTIONS_EXECUTED=0
PII_PERSISTED_COUNT=0
```

## Incident evidence extension

The simulation engine now includes return-to-origin and agency-pickup
workflows. It independently records customer and carrier evidence, applies
latest-event precedence, exposes conflicts to risk and QA gates, and keeps all
message and logistics actions disabled.

Thirty-two anonymized fixtures pass, including seven new conflict and
supersession cases. Explicit current return intent strictly blocks discount
and commercial-recovery proposals.
# Current status — ChatGPT MCP preparation

The VPS MCP is being prepared for private ChatGPT access but is not connected
or publicly exposed. It remains fixture-backed, read-only and simulation-only.
Secure MCP Tunnel is incompatible with the zero-OpenAI-API rule because the
official tunnel requires a Platform API key and `api.openai.com`.

No discount-template automation is active and no further template sends are
authorized in this checkpoint.

The hardened build is deployed privately: all nine containers are healthy,
24 MCP tests pass in the VPS container, the PostgreSQL write attempt is
blocked and only SSH is publicly listening. ChatGPT connection remains gated
on subscription compatibility and verified OAuth 2.1.

## 2026-07-31 — Private MCP and company Phase A

The private ChatGPT MCP connection is now authenticated and verified against
the VPS. It exposes only the approved read/simulation surface. The MCP database
role cannot write, the Action Executor is disabled and no OpenAI API key is
present.

Phase A of the Suleia Autonomous Operations Company is implemented as a
behavior-neutral organization contract in `platform-core`: six layers, forty
departments and forty deterministic primary agents. Every agent is
simulation-only and explicitly forbids customer messages, discounts, order
actions, production writes, policy mutation and external AI calls.

## 2026-07-31 — Phase B complete locally

Phase B now provides a central, versioned governance layer inside the existing
modular monolith: Policy Registry and Lifecycle, deterministic conflict
resolution, Risk Engine, QA Gate, technical Compliance, simulation-only
authorization, structured Decision Explanation and append-only governance
events.

The critical gate passes 38/38. Full regression passes 66/66 platform tests,
32/32 fictitious simulations, 29/29 MCP tests and 73/73 current AutoConfirm
tests. The MCP still exposes exactly the same eight read/simulation tools.

The Enterprise Intelligence Platform, Business Graph, Decision Memory,
Enterprise Twins, deterministic economic/strategic layers, Process
Intelligence, Control Tower and complete VPS migration are designed only.
No Phase B code or Enterprise design has been deployed. The VPS topology
remains 11 services, all agents remain inactive and local discount work remains
separate.

Current invariant result:

```text
OPENAI_API_CALLS=0
EXTERNAL_AI_CALLS=0
ACTIONS_EXECUTED=0
PRODUCTION_WRITES=0
MESSAGES_SENT=0
```
