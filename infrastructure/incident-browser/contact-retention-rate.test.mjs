import test from 'node:test';
import assert from 'node:assert/strict';
import { contactRequestSpacing } from './contact-retention-rate.mjs';
test('provider budget permits faster reads while retaining shared headroom', () => {
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'717'})),1500);
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'299'})),1500);
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'99'})),8000);
  assert.equal(contactRequestSpacing(new Headers({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'49'})),20000);
});
test('missing or invalid provider budget preserves conservative pacing', () => {
  for (const h of [{},{'x-ratelimit-limit':'1000'},{'x-ratelimit-limit':'0','x-ratelimit-remaining':'717'},{'x-ratelimit-limit':'1000','x-ratelimit-remaining':'invalid'}])
    assert.equal(contactRequestSpacing(new Headers(h)),8000);
});
