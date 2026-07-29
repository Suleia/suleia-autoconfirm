import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpApp } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function oauthConfig() {
  return loadConfig({
    environment: 'test',
    authMode: 'oauth',
    publicEndpointEnabled: true,
    publicBaseUrl: 'https://mcp.suleia.com',
    oauthIssuer: 'https://mcp.suleia.com/auth/realms/suleia',
    oauthAudience: 'suleia-mcp',
    oauthJwksUrl: 'http://keycloak:8080/auth/realms/suleia/protocol/openid-connect/certs',
    oauthRequiredRole: 'mcp_reader'
  });
}

test('OAuth metadata is public and an unauthenticated MCP request advertises it', async () => {
  const config = oauthConfig();
  const server = await listen(createHttpApp(config, {
    authOptions: { verify: async () => { throw new Error('invalid'); }, jwks: {} }
  }));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(metadata.status, 200);
    assert.deepEqual((await metadata.json()).authorization_servers, [config.oauthIssuer]);

    const unauthorized = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('OAuth requires both the reader role and every allowlisted scope', async () => {
  const config = oauthConfig();
  const verify = async () => ({
    payload: {
      sub: 'test-user',
      scope: config.grantedScopes.join(' '),
      realm_access: { roles: ['mcp_reader'] }
    }
  });
  const server = await listen(createHttpApp(config, {
    authOptions: { verify, jwks: {} }
  }));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer safe-test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'oauth-test', version: '1.0.0' }
        }
      })
    });
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('OAuth rejects a token without the required reader role', async () => {
  const config = oauthConfig();
  const verify = async () => ({
    payload: { sub: 'test-user', scope: config.grantedScopes.join(' '), realm_access: { roles: [] } }
  });
  const server = await listen(createHttpApp(config, {
    authOptions: { verify, jwks: {} }
  }));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer roleless-test-token', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
