# Suleia Operations MCP

Isolated read-only MCP prototype for the Suleia simulation environment.

## Safety state

- Fixture data only by default.
- One masked order.
- No production import.
- No deployment.
- No write tools.
- No action executors.
- `actions_executed = 0` for every simulation.
- Supabase access is limited to `GET` requests against six allowlisted staging views.

## Local validation

Use Node 22.22.x.

```powershell
pnpm install --frozen-lockfile
pnpm validate
```

The validation suite exercises both the in-memory MCP protocol and the local
stdio client. It also verifies Streamable HTTP with bearer authorization.

## Local HTTP

Set a temporary token with at least 32 characters, then start the service:

```powershell
$env:MCP_STAGING_BEARER_TOKEN = '<temporary-random-token>'
pnpm start
```

Endpoints:

- Health: `http://localhost:3100/health`
- MCP Streamable HTTP: `http://localhost:3100/mcp`

The token is for staging preflight only. ChatGPT registration should use OAuth
2.1 before the connector is created.

## Tools

1. `get_order`
2. `get_order_timeline`
3. `get_data_freshness`
4. `get_active_timers`
5. `get_agent_decisions`
6. `simulate_order_decision`
7. `compare_simulation_with_current_system`
8. `list_orders_requiring_review`

All tools are declared read-only, non-destructive and idempotent.
