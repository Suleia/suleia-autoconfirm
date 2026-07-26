# ChatGPT interactive review

## Intended connection

ChatGPT connects to the Suleia Operations MCP. The MCP reads masked staging data and runs deterministic simulations. ChatGPT never receives a Supabase or PostgreSQL credential.

## Registration instructions after authorization

1. Deploy the MCP behind HTTPS on the approved staging domain.
2. Verify `/health` and the Streamable HTTP `/mcp` endpoint.
3. Create a dedicated short-lived staging credential.
4. In ChatGPT settings, open Connectors or MCP servers.
5. Add the approved MCP URL.
6. Configure the approved bearer or OAuth method.
7. Grant only `orders:read` and `orders:simulate`.
8. Run `get_data_freshness`.
9. Query the single masked fixture order.
10. Run a simulation and confirm `actions_executed = 0`.
11. Inspect the MCP audit record.

## Forbidden

- Database credentials in ChatGPT.
- Production source data before authorization.
- Write scopes or tools.
- Connector secrets in prompts.
- Unmasked PII in responses or logs.
