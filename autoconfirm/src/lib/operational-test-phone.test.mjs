import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateOperationalTestPhone,
  normalizeSpanishOperationalPhone
} from './operational-test-phone.mjs';

test('normalizes only complete Spanish operational phone identities', () => {
  assert.equal(normalizeSpanishOperationalPhone('600 111 222'), '+34600111222');
  assert.equal(normalizeSpanishOperationalPhone('+34 600-111-222'), '+34600111222');
  assert.equal(normalizeSpanishOperationalPhone('0034 600111222'), '+34600111222');
  assert.equal(normalizeSpanishOperationalPhone('111222'), null);
});

test('blocks the exact protected phone without partial matching', () => {
  const config = { enabled: true, testPhoneNormalized: '+34600111222' };
  assert.equal(evaluateOperationalTestPhone('600111222', config).matched, true);
  assert.equal(evaluateOperationalTestPhone('111222', config).matched, false);
  assert.equal(evaluateOperationalTestPhone('600111223', config).matched, false);
});

test('does not block when the protection is disabled or misconfigured', () => {
  assert.equal(evaluateOperationalTestPhone('600111222', {
    enabled: false,
    testPhoneNormalized: '+34600111222'
  }).matched, false);
  assert.equal(evaluateOperationalTestPhone('600111222', {
    enabled: true,
    testPhoneNormalized: null
  }).matched, false);
});
