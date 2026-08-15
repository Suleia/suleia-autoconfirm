import test from 'node:test';
import assert from 'node:assert/strict';
import { syncChatbyReadOnly } from './readonly-sync.mjs';

const key = 'chatby-readonly-test-key-that-is-long-enough';

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('Chatby does not declare the source fresh when a conversation read fails', async () => {
  const freshness = [];
  const links = [];
  const pool = { query: async () => ({ rows: [{
    canonical_order_id: 'order-safe', external_order_id_hash: 'a'.repeat(64),
    dropea_order_id: '198765', canonical_issue_id: 'issue-safe',
    issue_created_at: '2026-08-01T09:00:00Z', issue_updated_at: '2026-08-01T09:05:00Z'
  }] }) };
  const result = await syncChatbyReadOnly({
    pool,
    projector: {
      upsertChatbyConversationLink: async (value) => links.push(value),
      recordSourceFreshness: async (value) => freshness.push(value)
    },
    token: 'test-token', hmacKey: key,
    fetchImpl: async (url) => new URL(url).pathname.endsWith('/subscribers')
      ? response({ data: [{ user_ns: 'conversation-fixture', user_fields: [{ name: 'Dropea: Número', value: '198765' }] }], meta: { current_page: 1, last_page: 1 } })
      : new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
  });

  assert.equal(result.ok, false);
  assert.equal(result.consultable, true);
  assert.equal(result.error, 'CHATBY_MESSAGE_READ_INCOMPLETE');
  assert.equal(result.conversation_statuses.BROKEN, 1);
  assert.equal(links[0].reason_code, 'CHATBY_MESSAGES_HTTP_401');
  assert.deepEqual(freshness, []);
  assert.equal(result.messages_sent, 0);
});
