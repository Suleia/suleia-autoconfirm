import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentAutomationRetry, discountSchedulerOwnsIncidentSync, incidentChatbyReadBlockCount } from './incident-automation-retry.mjs';

test('one enabled discount scheduler owns the complete incident sync; standalone sync remains otherwise', () => {
  assert.equal(discountSchedulerOwnsIncidentSync(true, 15), true);
  for (const interval of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(discountSchedulerOwnsIncidentSync(true, interval), false);
  }
  assert.equal(discountSchedulerOwnsIncidentSync(false, 15), false);
});

test('counts failed rejection reads without including other template lanes', () => {
  assert.equal(incidentChatbyReadBlockCount([
    { incidentType: 'rejected_goods', incidentDiscountRecoveryReason: 'chatby_final_read_failed' },
    { incidentType: 'rejected_goods', incidentDiscountRecoveryReason: 'chatby_pre_send_read_failed' },
    { incidentType: 'absent', incidentDiscountRecoveryReason: 'chatby_final_read_failed' },
    { incidentType: 'rejected_goods', incidentDiscountRecoveryReason: 'customer_interaction_after_merchandise_template' }
  ]), 2);
});

function fixture() {
  const timers = [];
  const cleared = [];
  let calls = 0;
  let cooldown = 195000;
  const retry = createIncidentAutomationRetry({
    getRetryAfterMs: () => cooldown,
    scheduleRetry: () => { calls += 1; },
    setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimer: (timer) => cleared.push(timer)
  });
  return { retry, timers, cleared, calls: () => calls, cooldown: (value) => { cooldown = value; } };
}
const blocked = { discountRecoverySummary: { blockedChatbyRead: 12 } };

test('resumes once after Retry-After without a blocking sleep', () => {
  const f = fixture();
  assert.equal(f.retry.consider(blocked), true);
  assert.equal(f.timers[0].delay, 196000);
  assert.equal(f.calls(), 0);
  f.timers[0].callback();
  assert.equal(f.calls(), 1);
});

test('coalesces repeated blocked cycles and invalidates a superseded callback', () => {
  const f = fixture();
  f.retry.consider(blocked);
  f.cooldown(240000);
  f.retry.consider(blocked);
  assert.equal(f.cleared.length, 1);
  f.timers[0].callback();
  assert.equal(f.calls(), 0);
  f.timers[1].callback();
  assert.equal(f.calls(), 1);
});

test('does not accelerate customer activity or invalid cooldown metadata', () => {
  const f = fixture();
  assert.equal(f.retry.consider({ discountRecoverySummary: { blockedByCustomerActivity: 2 } }), false);
  for (const value of [-1, NaN, Infinity]) {
    f.cooldown(value);
    assert.equal(f.retry.consider(blocked), false);
  }
  assert.equal(f.timers.length, 0);
});

test('network read failures back off automatically and successful cycles cancel a pending retry', () => {
  const f=fixture();f.cooldown(0);
  assert.equal(f.retry.consider(blocked),true);assert.equal(f.timers[0].delay,61000);
  f.timers[0].callback();assert.equal(f.calls(),1);
  f.retry.consider(blocked);assert.equal(f.timers[1].delay,121000);
  f.retry.consider({discountRecoverySummary:{blockedChatbyRead:0}});
  f.timers[1].callback();assert.equal(f.calls(),1);
});

test('a last-moment return read failure is retried but other incident lanes never are', () => {
  assert.equal(incidentChatbyReadBlockCount([
    {incidentType:'rejected_goods',incidentDiscountReturnStatus:'BLOCKED_CHATBY_READ_FAILED'},
    {incidentType:'absent',incidentDiscountReturnStatus:'BLOCKED_CHATBY_READ_FAILED'}
  ]),1);
});
