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
- `simulate_order_decision`
- `compare_simulation_with_current_system`
- `list_orders_requiring_review`

## Authentication

The temporary staging design uses a random bearer token over TLS. It is acceptable only while access is tightly restricted. OAuth 2.1 security practices with Authorization Code and PKCE are the public-staging target. The options and acceptance gates are documented in `AUTHENTICATION_OPTIONS.md`.

## Scopes

- `orders:read`
- `orders:simulate`

There is no write scope and no write tool. The MCP database role can read only the allowlisted masked views in the `mcp` schema. Its only write privilege is an insert into the append-only call audit table.

## Response controls

- Mask PII recursively.
- Reject output that fails the PII scan.
- Include freshness and run mode.
- Include `actions_executed = 0` in simulations.
- Record principal hash, scopes, tool, request hash, response hash and duration.

## URL placeholder

`https://mcp-staging.<approved-domain>/mcp`

The URL is not live and must not be registered until public staging is explicitly authorized.

Rate limiting is enforced inside the MCP server. The stock Caddy image is deliberately retained rather than adding an unreviewed rate-limit plugin.
