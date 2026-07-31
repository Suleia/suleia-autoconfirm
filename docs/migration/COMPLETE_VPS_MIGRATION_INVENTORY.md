# Complete VPS migration inventory

Status: planning only. The current Render/Supabase system remains authoritative.
Secret names are inventoried; secret values are never copied into this file.

| current_component | current_host/runtime | current_database | owner | secrets | schedule/dependencies | current_cost | target_vps_component/container/database/policy | parity | risk | rollback | readiness |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AutoConfirm web/API | Render Docker web | Supabase plus operational cache | Operations | Shopify, Chatby, Dropea, Meta references | HTTP plus internal polling; external connectors | Existing paid plan; exact account value pending | API plus ingestion/decision modules; `api`; PostgreSQL; simulation then shadow policy | Partial | HIGH | Route traffic back to Render | NOT_READY |
| Unanswered cancellation sweep | Render cron | Supabase/cache | Operations | Dropea and Chatby references | Every five hours; live 36-hour config conflict | Existing paid plan | Scheduler module; `scheduler`; PostgreSQL timers; current authority retained | Conflict inventoried | CRITICAL until policy resolved | Keep Render cron authoritative | BLOCKED |
| Confirmation delay | Render web worker | Supabase/cache | Order Confirmation | Chatby and Dropea references | One-hour timer and conversation reread | Included above | Timer plus decision modules; `scheduler`/`decision-engine`; central policy | Fixture parity | HIGH | Keep current timer/worker | NOT_READY |
| Incident synchronization | Render worker | Supabase/cache | Incident Management | Dropea, Chatby, carrier references | Periodic incident reads; 48-hour workflows | Included above | Ingestion and timer modules; PostgreSQL | Fixture parity | HIGH | Keep Render workflow | NOT_READY |
| Template delivery ledger | Supabase | Supabase primary-key ledger | Customer Communication | Supabase service reference | Atomic per-order/template idempotency | Existing Supabase | PostgreSQL idempotency table; event fabric policy | Contract only | CRITICAL | Continue Supabase ledger | NOT_READY |
| Operational records | Supabase | Supabase tables/views | Data Platform | Supabase URL/key references | API reads/writes from current service | Existing Supabase | PostgreSQL schemas and controlled import | Schema prepared | CRITICAL | Supabase remains authority | NOT_READY |
| Local operational cache | Render persistent/runtime storage | JSON/cache | Platform | None beyond service environment | Coupled to AutoConfirm runtime | Included above | PostgreSQL derived state; no file authority | Partial | HIGH | Preserve current cache | NOT_READY |
| Shopify order input | Shopify webhooks/API | Shopify authoritative | Order Acquisition | Shopify domain/token reference | Webhook and poll paths | Existing merchant service | Read-only ingestion adapter; `ingestion-worker`; Event Store | Contract only | HIGH | Keep current webhook destination | NOT_READY |
| Chatby conversation/input | Chatby API/automation | Chatby authoritative | Customer Communication | Chatby token reference | Reads plus current production sends | Existing external service | Read-only ingestion first; no write connector enabled | MCP/fixture only | CRITICAL | Current service remains sender | NOT_READY |
| Dropea order/actions | Dropea API | Dropea authoritative | Logistics | Dropea key/token references | Reads plus current production actions | Existing external service | Read-only ingestion first; action executor disabled | Fixture only | CRITICAL | Current service remains executor | NOT_READY |
| GLS/carrier evidence | Carrier through current integration | Carrier source | Logistics | Carrier references if configured | Shipment and incident status | Existing arrangement | Read-only connector and normalized events | Contract only | HIGH | Current integration remains source | NOT_READY |
| Meta dashboard data | Meta API | Local/Supabase summaries | Marketing Intelligence | Meta token reference | Configured periodic synchronization | Existing external service | Read-only ingestion and reporting views | Not assessed | MEDIUM | Keep current sync | NOT_READY |
| Google Sheets operations | Google Sheets when enabled | Sheet | Operations | Google credential reference | Currently configuration-dependent | Existing workspace | Inventory/read-only reconciliation only | Disabled or unknown | HIGH | Keep sheet untouched | BLOCKED_PENDING_AUDIT |
| Review/dashboard UI | Render web/static | Current API/cache | Human Review | Session/access configuration | On demand | Included above | `review-panel`; PostgreSQL masked views | Staging shell present | MEDIUM | Use existing dashboard | NOT_READY |
| Private MCP | Contabo VPS; Node | Masked PostgreSQL views | Platform | OAuth configuration in protected environment | On demand; eight tools | Existing VPS | `mcp-server`, `mcp-edge`, Keycloak; unchanged | Verified read-only | LOW | Disable endpoint/restore config | READY_CURRENT_SCOPE |
| Logs and audit | Render/Supabase plus VPS local monitoring | Multiple | Audit | No plaintext secrets permitted | Continuous | Existing plans | Structured event/audit tables plus `monitoring` | Partial | HIGH | Preserve original logs | NOT_READY |
| Backups | Provider backups plus VPS encrypted process | Provider/PostgreSQL | Backup & Restore | Protected backup reference | Scheduled/verified restore | Existing plans | VPS PostgreSQL backup/restore | VPS staging verified | MEDIUM | Provider restore plus VPS restore | NOT_READY_FOR_AUTHORITY |
| Secret custody | Render/Supabase environments and VPS protected env | N/A | Platform Security | Names only in inventory | Loaded at runtime | No new cost planned | Approved secret manager or protected VPS env; migration last | Not started | CRITICAL | Leave originals unchanged | NOT_READY |

## VPS target already present

The current private compose stack has 11 services: PostgreSQL, API, ingestion
worker, scheduler, decision engine, monitoring, review panel, reverse proxy,
MCP edge, MCP server and Keycloak. Phase B adds no service or resident process.

Migration stages remain Inventory, Read-only Mirror, Shadow, Dual Verification,
Canary 1%, Progressive Cutover, Full VPS Authority, Render Shutdown and
Supabase Shutdown. Only planning and parity preparation are authorized.
