# Read-only MCP

## Transports

- Local tests: stdio.
- Remote staging: Streamable HTTP.

## Tools

- `get_order`
- `get_order_timeline`
- `get_data_freshness`
- `get_active_timers`
- `get_agent_decisions`
- `preview_order_decision`
- `compare_simulation_with_current_system`
- `list_orders_needing_ai_review`
- `search_orders`
- `search_incidents`
- `get_incident`
- `search_operational_findings`
- `get_platform_overview`
- `get_runtime_inventory`
- `get_database_catalog`
- `get_component_details`

## Authentication

The public private endpoint uses OAuth Authorization Code with PKCE through
Keycloak. ChatGPT receives the read-only scopes as default client scopes and
must hold the `mcp_reader` role.

## Scopes

- `orders:read`
- `orders:simulate`
- `timelines:read`
- `decisions:read`
- `reviews:read`
- `platform:read`

There is no write scope and no write tool. `suleia_mcp_readonly` and
`suleia_platform_audit_readonly` are strict database read roles. MCP audit
events are emitted by the structured application logger; neither role has
INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, GRANT or role-switching capability.

## Response controls

- Mask PII recursively.
- Reject output that fails the PII scan.
- Include freshness and run mode.
- Include `actions_executed = 0` in simulations.
- Record principal hash, scopes, tool, request hash, response hash and duration.

## Endpoint

`https://mcp.suleia.com/mcp`

Rate limiting is enforced inside the MCP server. The stock Caddy image is deliberately retained rather than adding an unreviewed rate-limit plugin.
