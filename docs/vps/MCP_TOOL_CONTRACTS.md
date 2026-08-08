# MCP tool contracts

All schemas reject additional properties. Inputs accept only bounded technical
identifiers, enums, ISO timestamps and numeric limits. They accept no SQL,
URLs, filesystem paths, commands, code or generic request bodies.

| Tool | Scope | Limits |
| --- | --- | --- |
| `get_order` | `orders:read` | one masked order |
| `get_order_timeline` | `timelines:read` | one order, up to 100 events |
| `get_data_freshness` | `orders:read` | metadata only |
| `get_active_timers` | `orders:read` | optional order and allowlisted timer type |
| `get_agent_decisions` | `decisions:read` | one order, up to 20 decisions |
| `preview_order_decision` | `orders:read`, `timelines:read`, `orders:simulate` | one order, simulation only |
| `compare_simulation_with_current_system` | `orders:read`, `timelines:read`, `decisions:read`, `orders:simulate` | one order, simulation only |
| `list_orders_needing_ai_review` | `reviews:read` | up to 5 masked orders |
| `search_orders` | `orders:read` | parameterized filters, up to 50 rows |
| `search_incidents` | `orders:read` | parameterized filters, up to 50 rows |
| `get_incident` | `orders:read`, `decisions:read` | one canonical or Dropea issue identifier |
| `search_operational_findings` | `reviews:read` | parameterized filters, up to 50 rows |
| `get_platform_overview` | `platform:read` | allowlisted architecture, agent, policy and timer catalog |
| `get_runtime_inventory` | `platform:read` | sanitized runtime snapshot, up to 50 services |
| `get_database_catalog` | `platform:read` | fixed pg_catalog queries, up to 50 metadata objects |
| `get_component_details` | `platform:read` | one allowlisted component, dependency depth at most 5 |

Every successful result includes `run_mode=SIMULATION`,
`actions_executed=0`, `source`, `environment`, `source_updated_at`,
`measured_at`, `freshness`, PII masking metadata and the warning that external
content is untrusted. There are no write tools or write scopes.

