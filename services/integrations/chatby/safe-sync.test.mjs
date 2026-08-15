import test from 'node:test';
import assert from 'node:assert/strict';
import { chatbyErrorCode, syncChatbyWithRecovery } from './safe-sync.mjs';

test('Chatby recovery records an unavailable source without exposing error messages', async () => {
  const failures = [];
  const result = await syncChatbyWithRecovery({
    projector: { recordSourceFailure: async (value) => failures.push(value) },
    sync: async () => {
      const error = new Error('request contained a sensitive response body');
      error.code = 'CHATBY_SUBSCRIBERS_HTTP_401';
      throw error;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'CHATBY_SUBSCRIBERS_HTTP_401');
  assert.equal(result.freshness_persisted, true);
  assert.deepEqual(failures, [{ source: 'chatby', status: 'UNAVAILABLE' }]);
  assert.doesNotMatch(JSON.stringify(result), /sensitive response body/);
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
  assert.equal(result.messages_sent, 0);
});

test('Chatby recovery marks partial message reads as degraded', async () => {
  const failures = [];
  const result = await syncChatbyWithRecovery({
    projector: { recordSourceFailure: async (value) => failures.push(value) },
    sync: async () => ({ ok: false, enabled: true, consultable: true, error: 'CHATBY_MESSAGE_READ_INCOMPLETE' })
  });

  assert.equal(result.error, 'CHATBY_MESSAGE_READ_INCOMPLETE');
  assert.deepEqual(failures, [{ source: 'chatby', status: 'DEGRADED' }]);
});

test('Chatby recovery preserves a successful result without recording a failure', async () => {
  let recorded = false;
  const expected = Object.freeze({ ok: true, enabled: true, consultable: true });
  const result = await syncChatbyWithRecovery({
    projector: { recordSourceFailure: async () => { recorded = true; } },
    sync: async () => expected
  });

  assert.equal(result, expected);
  assert.equal(recorded, false);
});

test('Chatby error codes reject arbitrary text', () => {
  assert.equal(chatbyErrorCode({ code: 'CHATBY_HTTP_503' }), 'CHATBY_HTTP_503');
  assert.equal(chatbyErrorCode({ code: 'token=secret value' }), 'CHATBY_READ_FAILED');
});
