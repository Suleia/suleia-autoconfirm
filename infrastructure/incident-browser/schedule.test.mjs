import test from 'node:test';
import assert from 'node:assert/strict';
import {startSchedule, CYCLE_INTERVAL_MS} from './schedule.mjs';

test('server startup and recurring ticks run across midnight without overlap and recover from failure', async () => {
 let time = Date.parse('2026-10-14T23:45:00Z'), tick, interval, calls = 0, release;
 const errors = [];
 const {state} = startSchedule(async () => {
  calls++;
  if (calls === 1) await new Promise(resolve => { release = resolve; });
  if (calls === 2) throw Error('TEST_FAILURE');
 }, {now: () => time, every: (fn, ms) => {tick = fn; interval = ms;}, onError: error => errors.push(error.message)});
 assert.equal(calls, 1);
 assert.equal(interval, 1800000);
 assert.equal(state.intervalMinutes, 30);
 assert.equal(state.nextRunAt, '2026-10-15T00:15:00.000Z');
 time += CYCLE_INTERVAL_MS;
 await tick();
 assert.equal(calls, 1);
 release();
 await new Promise(resolve => setImmediate(resolve));
 time += CYCLE_INTERVAL_MS;
 await tick();
 assert.deepEqual(errors, ['TEST_FAILURE']);
 time += CYCLE_INTERVAL_MS;
 await tick();
 assert.equal(calls, 3);
 assert.equal(state.nextRunAt, '2026-10-15T01:45:00.000Z');
});
