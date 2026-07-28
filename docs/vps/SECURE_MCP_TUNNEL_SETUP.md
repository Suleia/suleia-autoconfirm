# Secure MCP Tunnel assessment

## Decision

Do not install the official Secure MCP Tunnel under the current zero-API
policy.

The official setup requires a Platform tunnel identifier, a runtime control
plane API key and outbound HTTPS access to `api.openai.com` tunnel endpoints.
Those requirements conflict directly with:

- no OpenAI API key;
- no calls to `api.openai.com`;
- no API billing or token balance;
- zero additional OpenAI API cost.

No tunnel binary, credential, service or firewall rule has been installed.
The supported fallback is a dedicated remote HTTPS MCP endpoint protected by
OAuth 2.1, but it remains disabled until plan compatibility and OAuth are
verified. No other VPS service may be exposed as a workaround.

