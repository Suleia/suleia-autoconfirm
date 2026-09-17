import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowWorkerHealth,applyAbsentReadHealth } from './shadow-worker-health.mjs';

test('an AUSENTE throttle is unhealthy even after an earlier successful cycle and preserves the actual retry deadline',()=>{
 const prior={ok:true,completed_at:'2026-09-17T15:47:05Z'};const until=Date.parse('2026-09-17T16:01:01Z');
 const h=applyAbsentReadHealth(shadowWorkerHealth({lastResult:{ok:true},lastError:null,running:false}),{lastResult:prior,lastError:'CHATBY_SUBSCRIBERS_HTTP_429',retryNotBefore:until});
 assert.equal(h.statusCode,503);assert.equal(h.body.ok,false);assert.equal(h.body.absent_shadow.last_sync_ok,false);assert.equal(h.body.absent_shadow.last_completed_cycle_at,prior.completed_at);assert.equal(h.body.absent_shadow.retry_not_before,new Date(until).toISOString());
});

test('AUSENTE health recovers only after the next successful read, not by relabelling old success',()=>{
 const h=applyAbsentReadHealth(shadowWorkerHealth({lastResult:{ok:true},lastError:null,running:false}),{lastResult:{ok:true,completed_at:'2026-09-17T16:03:01Z'},lastError:null});
 assert.equal(h.statusCode,200);assert.equal(h.body.absent_shadow.last_sync_ok,true);assert.equal(h.body.absent_shadow.last_error,null);assert.equal(h.body.actions_executed,0);
});

test('worker is not healthy before the first complete synchronization', () => {
  const state = shadowWorkerHealth({ lastResult: null, lastError: null, running: true });
  assert.equal(state.statusCode, 503);
  assert.equal(state.body.ok, false);
  assert.equal(state.body.first_cycle_complete, false);
  assert.equal(state.body.last_sync_ok, null);
});

test('worker becomes healthy only after a successful complete synchronization', () => {
  const state = shadowWorkerHealth({ lastResult: { ok: true }, lastError: null, running: false });
  assert.equal(state.statusCode, 200);
  assert.equal(state.body.ok, true);
  assert.equal(state.body.first_cycle_complete, true);
  assert.equal(state.body.actions_executed, 0);
  assert.equal(state.body.production_writes, 0);
});

test('worker stays unhealthy after a failed synchronization', () => {
  const state = shadowWorkerHealth({ lastResult: { ok: false }, lastError: 'SAFE_FAILURE', running: false });
  assert.equal(state.statusCode, 503);
  assert.equal(state.body.ok, false);
  assert.equal(state.body.last_error, 'SAFE_FAILURE');
});

