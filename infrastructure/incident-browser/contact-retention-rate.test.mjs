import test from 'node:test';
import assert from 'node:assert/strict';
import { contactRequestSpacing, contactBudgetYieldUntil } from './contact-retention-rate.mjs';
test('provider budget permits faster reads while retaining shared headroom', () => {
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'717'})),1500);
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'299'})),1500);
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'99'})),8000);
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'49'})),20000);
});
test('bulk work yields before consuming messaging reserve, without inventing a reset', () => {
  const now = Date.parse('2026-10-20T09:00:00Z');
  assert.equal(contactBudgetYieldUntil(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'99'}), now),'2026-10-20T09:20:00.000Z');
  assert.equal(contactBudgetYieldUntil(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'100'}), now),null);
  assert.equal(contactBudgetYieldUntil(new Headers(),now),null);
  assert.equal(contactBudgetYieldUntil(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'invalid'}),now),null);
});
test('provider reset and retry-after are honored conservatively', () => {
  const now = Date.parse('2026-10-20T09:00:00Z');
  const base={'x-ratelimit-limit':'1000','x-ratelimit-remaining':'0'};
  assert.equal(contactBudgetYieldUntil(new Headers({...base,'retry-after':'1800'}),now),'2026-10-20T09:30:00.000Z');
  assert.equal(contactBudgetYieldUntil(new Headers({...base,'retry-after':'Tue, 20 Oct 2026 09:25:00 GMT'}),now),'2026-10-20T09:25:00.000Z');
  assert.equal(contactBudgetYieldUntil(new Headers({...base,'x-ratelimit-reset':String((now+3600000)/1000)}),now),'2026-10-20T10:00:00.000Z');
});
test('missing or invalid provider budget preserves conservative pacing', () => {
  for (const h of [{},{'x-ratelimit-limit':'1000'},{'x-ratelimit-limit':'0','x-ratelimit-remaining':'717'},{'x-ratelimit-limit':'1000','x-ratelimit-remaining':'invalid'}])
    assert.equal(contactRequestSpacing(new Headers(h)),8000);
});
