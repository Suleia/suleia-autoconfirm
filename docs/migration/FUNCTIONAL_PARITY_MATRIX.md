# Functional parity matrix

| capability | current authority | VPS target | evidence required | current status | gate |
|---|---|---|---|---|---|
| Order ingestion | Shopify/Render | ingestion worker/Event Store | count, checksum, latency, dedupe | Fixture only | Read-only mirror |
| Conversation evidence | Chatby/current service | normalized masked events | current-order correlation and freshness | Fixture only | Read-only mirror |
| Logistics evidence | Dropea/carrier | normalized events and order twin | status/incident reconciliation | Fixture only | Read-only mirror |
| One-hour confirmation | Render | timer and governance simulation | timer boundary and reread parity | Core fixture pass | Shadow |
| Incident windows | Render | timer/policy simulation | AUSENTE/FALTAN_DATOS/NO_RESPUESTA parity | Core fixture pass | Shadow |
| Historic timeout cancellation | Render live configuration | deprecated comparison-only policy | owner resolution of conflict | CONFLICT | Blocked |
| Template idempotency | Supabase ledger | PostgreSQL idempotency contract | concurrency and recovery tests | Current production verified; VPS absent | Blocked |
| Customer messaging | Current service | future write connector | explicit later authorization | Disabled on VPS | Not authorized |
| Confirm/cancel/return | Current service | future action executor | dual verification and action audit | Disabled on VPS | Not authorized |
| Policy governance | Dispersed/current code | central simulation registry | schema, lifecycle, conflict and rollback tests | Phase B complete locally | Design review |
| Risk/QA/compliance | Partial current logic | central simulation gates | full deterministic suite | Phase B complete locally | Design review |
| Dashboard/review | Current dashboard | VPS review panel | masked field and workflow parity | Partial | Read-only shadow |
| MCP | VPS private | unchanged | exactly eight tools, OAuth, masking, zero writes | Verified | Preserve |
| Backups/restore | Providers plus VPS | VPS encrypted restore | scheduled restore drills and RPO/RTO | Staging drill verified | Pre-authority |

`Exact match`, `partial match`, `expected difference`, `unexpected difference`,
`insufficient data`, `false positive`, `false negative`, `blocked` and `human
override` are the canonical comparison outcomes.

## C0 implementation evidence

The local Functional Parity Engine now reports MATCHED, PARTIAL, DIVERGENT,
BLOCKED, NOT_COMPARABLE and NOT_ASSESSED by dimension. The Reconciliation
Ledger fingerprints canonical masked comparisons, deduplicates idempotency
keys, counts recurrence and survives a simulated restart. This is fixture
evidence only; every real-data row in the matrix remains gated.
