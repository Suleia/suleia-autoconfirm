import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafetyInvariants, loadConfig } from '../src/config.mjs';

test('safe fixture configuration boots read-only', () => {
  const config = loadConfig({
    dataMode: 'fixture',
    readOnly: true,
    simulationOnly: true,
    productionWritesEnabled: false,
    actionExecutorEnabled: false,
    writeToolsEnabled: false
  });
  assert.equal(config.readOnly, true);
});

for (const unsafe of [
  { readOnly: false },
  { simulationOnly: false },
  { productionWritesEnabled: true },
  { actionExecutorEnabled: true },
  { writeToolsEnabled: true },
  { openAiApiEnabled: true },
  { externalLlmCallsEnabled: true },
  { realDataWriteEnabled: true },
  { connectorWriteEnabled: true },
  { publicEndpointEnabled: true }
]) {
  test(`unsafe configuration is rejected: ${Object.keys(unsafe)[0]}`, () => {
    assert.throws(() => assertSafetyInvariants({
      dataMode: 'fixture',
      readOnly: true,
      simulationOnly: true,
      productionWritesEnabled: false,
      actionExecutorEnabled: false,
      writeToolsEnabled: false,
      authMode: 'bearer',
      rateLimitPerMinute: 30,
      toolTimeoutMs: 10_000,
      maxResponseBytes: 51_200,
      ...unsafe
    }), /Unsafe MCP configuration/);
  });
}

test('supabase mode rejects a production or unknown project ref', () => {
  assert.throws(() => assertSafetyInvariants({
    dataMode: 'supabase',
    supabaseUrl: 'https://example.supabase.co',
    supabaseReaderToken: 'reader',
    supabaseProjectRef: 'production-ref',
    expectedStagingProjectRef: 'staging-ref',
    readOnly: true,
    simulationOnly: true,
    productionWritesEnabled: false,
    actionExecutorEnabled: false,
    writeToolsEnabled: false
  }), /approved staging project/);
});

test('public OAuth configuration is accepted only with complete HTTPS identity metadata', () => {
  const config = loadConfig({
    environment: 'test',
    authMode: 'oauth',
    publicEndpointEnabled: true,
    publicBaseUrl: 'https://mcp.suleia.com',
    oauthIssuer: 'https://mcp.suleia.com/auth/realms/suleia',
    oauthAudience: 'suleia-mcp',
    oauthJwksUrl: 'http://keycloak:8080/auth/realms/suleia/protocol/openid-connect/certs',
    oauthRequiredRole: 'mcp_reader'
  });
  assert.equal(config.authMode, 'oauth');
});

test('incomplete public OAuth configuration fails closed', () => {
  assert.throws(() => loadConfig({
    environment: 'test',
    authMode: 'oauth',
    publicEndpointEnabled: true
  }), /HTTPS MCP_PUBLIC_BASE_URL/);
});
