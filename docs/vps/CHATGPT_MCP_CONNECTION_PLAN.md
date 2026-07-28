# ChatGPT MCP connection plan

Status: prepared but deliberately not connected.

## Approved architecture

ChatGPT may connect only to the eight-tool Suleia MCP surface. The MCP remains
private, read-only and simulation-only. PostgreSQL, the internal API, the
review panel, Docker and metrics remain unexposed.

The intended app name is `Suleia Operations — Private Read-Only`.

## Mandatory gates

1. The account owner confirms that ChatGPT Developer mode and private custom
   MCP apps are available under the current subscription.
2. No plan purchase or OpenAI API billing is required.
3. An officially supported OAuth 2.1 authorization server is configured with
   Authorization Code and PKCE.
4. OAuth issuer, audience, expiry, revocation and the five read/simulation
   scopes pass validation.
5. Only then may a dedicated HTTPS MCP endpoint be exposed.

The current private bearer credential is for VPS-local validation only. The
configuration fails closed if a public endpoint is enabled with bearer auth.

## Manual ChatGPT steps after all gates pass

Enable Developer mode, open Apps, choose Create, enter the approved HTTPS MCP
endpoint, select OAuth, scan tools, confirm exactly eight tools and save the
app as private. Do not publish, share or enable bulk synchronization.

No endpoint is included here because public exposure is not yet authorized.

