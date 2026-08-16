import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/018_order_chatby_signal_projection.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/018_order_chatby_signal_projection.down.sql', import.meta.url), 'utf8');

test('order context falls back to the masked Chatby summary without external actions', () => {
  assert.match(migration, /LEFT JOIN read_models\.operations_conversation_summaries cs/);
  assert.match(migration, /coalesce\(ai\.customer_intent,cs\.detected_intent\) AS latest_customer_intent/);
  assert.match(migration, /coalesce\(ai\.conversation_status,CASE WHEN cs\.canonical_order_id IS NOT NULL THEN 'FOUND' END\)/);
  assert.doesNotMatch(migration, /customer_(?:name|phone|email)|last_customer_message|message_text/i);
  assert.doesNotMatch(migration, /INSERT INTO (?:dropea|chatby)|UPDATE (?:dropea|chatby)|DELETE FROM/i);
});

test('order Chatby projection has a scoped rollback', () => {
  assert.match(rollback, /CREATE OR REPLACE VIEW read_models\.operations_order_context/);
  assert.doesNotMatch(rollback, /operations_conversation_summaries cs/);
  assert.doesNotMatch(rollback, /DROP TABLE|DROP SCHEMA|TRUNCATE/i);
});
