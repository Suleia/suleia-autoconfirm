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
