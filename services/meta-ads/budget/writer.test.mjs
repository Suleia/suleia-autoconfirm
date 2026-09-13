import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaBudgetWriter } from './writer.mjs';
import { assertMetaWriteAllowed, META_LIVE_WRITER_COMPILED } from './write-gate.mjs';

test('writer is absent at compile time and all modes fail before any HTTP mutation', () => {
  assert.equal(META_LIVE_WRITER_COMPILED, false);
  const events = []; const writer = new MetaBudgetWriter({ audit: (event) => events.push(event) });
  for (const mode of ['SIMULATION', 'SHADOW', 'APPROVAL_REQUIRED', 'LIVE']) {
    assert.throws(() => writer.executeChange({}, { mode, writesEnabled: true, liveExecutionEnabled: true,
      externalActionsEnabled: true, validAuthorization: true, validPolicyDecision: true, metricsStatus: 'FRESH',
      validBudget: true, validCampaign: true, validApproval: true }), (error) => {
      assert.equal(error.code, 'BLOCKED_BY_SIMULATION_MODE');
      assert.equal(error.meta_budget_writes, 0); assert.equal(error.production_writes, 0); return true;
    });
  }
  assert.equal(events.length, 4); assert.equal(events.every((event) => event.event === 'META_WRITE_BLOCKED'), true);
  assert.throws(() => assertMetaWriteAllowed({}), { code: 'BLOCKED_BY_SIMULATION_MODE' });
});

test('future approvals are declared but return feature not enabled', () => {
  const writer = new MetaBudgetWriter();
  assert.equal(writer.createApproval().code, 'FEATURE_NOT_ENABLED');
  assert.equal(writer.executeApprovedChange().code, 'FEATURE_NOT_ENABLED');
});

test('source contains no mutable HTTP method or Telegram sender', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('./writer.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|axios|telegram|POST|PATCH|DELETE)\b/i);
});
