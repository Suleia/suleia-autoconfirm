import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentSyncQueue } from './incident-sync-queue.mjs';

test('scheduler and recovery requests share a cycle while distinct scopes wait', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const sync = createIncidentSyncQueue(async options => { calls.push(options); if (calls.length === 1) await gate; return calls.length; });
  const first = sync();
  assert.equal(sync(), first);
  const targeted = sync({ returnOnly: true });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  release();
  assert.equal(await first, 1);
  assert.equal(await targeted, 2);
  assert.equal(await sync(), 3);
});

test('a failed cycle releases the queue for the next autonomous cycle', async () => {
  let count = 0;
  const sync = createIncidentSyncQueue(async () => { if (++count === 1) throw Error('provider unavailable'); return 'ok'; });
  await assert.rejects(sync(), /provider unavailable/);
  assert.equal(await sync(), 'ok');
});
