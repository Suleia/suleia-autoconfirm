# Current status

Updated: 2026-07-28

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
