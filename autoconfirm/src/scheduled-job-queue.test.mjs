import assert from 'node:assert/strict';
import test from 'node:test';
import { createScheduledJobQueue } from './scheduled-job-queue.mjs';

test('serializes scheduled jobs', async () => {
  const events = [];
  const queue = createScheduledJobQueue();
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.schedule('first', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = queue.schedule('second', async () => {
    events.push('second:start');
    events.push('second:end');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('coalesces duplicate pending jobs', async () => {
  const queue = createScheduledJobQueue();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const first = queue.schedule('orders', async () => gate);
  const duplicate = await queue.schedule('orders', async () => {
    throw new Error('duplicate job should not run');
  });

  assert.equal(duplicate.skipped, true);
  release();
  await first;
  assert.equal(queue.pendingCount(), 0);
});

test('continues after a failed job', async () => {
  const queue = createScheduledJobQueue();
  const events = [];
  const failed = queue.schedule('failed', async () => {
    throw new Error('expected');
  });
  const next = queue.schedule('next', async () => {
    events.push('next');
  });

  await assert.rejects(failed, /expected/);
  await next;
  assert.deepEqual(events, ['next']);
});
