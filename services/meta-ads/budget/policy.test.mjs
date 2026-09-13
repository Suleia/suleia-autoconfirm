import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMetaBudgetPolicy, madridBusinessTime, META_BUDGET_POLICY_V1 } from './policy.mjs';

const atMadrid = (localHour, localMinute = 0, day = '2026-09-13') => {
  const utcHour = localHour - 2;
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCHours(utcHour, localMinute, 0, 0);
  return date;
};

function evaluate(options = {}) {
  const { hour = 10, minute = 0, budget = 4_000, metricsStatus = 'FRESH', ...overrides } = options;
  const roas = Object.hasOwn(options, 'roas') ? options.roas : '6';
  return evaluateMetaBudgetPolicy({ currentBudgetCents: budget, purchaseRoas: roas, metricsStatus,
    budgetModel: 'CBO', budgetPeriod: 'DAILY', campaignStatus: 'ACTIVE', currency: 'EUR',
    evaluatedAt: atMadrid(hour, minute), policy: META_BUDGET_POLICY_V1, ...overrides });
}

test('implements every mandatory policy example', () => {
  const cases = [
    [{ hour: 7, budget: 1500, roas: '7' }, ['WOULD_INCREASE', 2500]],
    [{ hour: 8, budget: 2500, roas: '6.1' }, ['WOULD_INCREASE', 3500]],
    [{ hour: 9, budget: 6500, roas: '8' }, ['WOULD_INCREASE', 7000]],
    [{ hour: 10, budget: 7000, roas: '9' }, ['HOLD_MAX_BUDGET', 7000]],
    [{ hour: 10, budget: 4000, roas: '6' }, ['HOLD_ROAS_NEUTRAL', 4000]],
    [{ hour: 10, budget: 4000, roas: '3' }, ['HOLD_ROAS_NEUTRAL', 4000]],
    [{ hour: 10, budget: 4000, roas: '2.9' }, ['HOLD_LOW_ROAS', 4000]],
    [{ hour: 2, budget: 3500, roas: '12' }, ['HOLD_NIGHT', 3500]],
    [{ hour: 2, budget: 2500, roas: '12' }, ['HOLD_NIGHT', 2500]],
    [{ hour: 0, budget: 7000, roas: '12' }, ['WOULD_REDUCE_TO_NIGHT_CAP', 3500]],
    [{ hour: 6, budget: 3500, roas: '10' }, ['HOLD_NIGHT', 3500]],
    [{ hour: 7, budget: 3500, roas: '10' }, ['WOULD_INCREASE', 4500]]
  ];
  for (const [input, expected] of cases) {
    const result = evaluate(input);
    assert.equal(result.reasonCode, expected[0], JSON.stringify(input));
    assert.equal(result.budgetProposedCents, expected[1], JSON.stringify(input));
  }
});

test('covers exact ROAS boundaries without floating point budget arithmetic', () => {
  const cases = [['2.99', 'HOLD_LOW_ROAS'], ['3.00', 'HOLD_ROAS_NEUTRAL'], ['3.01', 'HOLD_ROAS_NEUTRAL'],
    ['5.99', 'HOLD_ROAS_NEUTRAL'], ['6.00', 'HOLD_ROAS_NEUTRAL'], ['6.01', 'WOULD_INCREASE']];
  for (const [roas, reason] of cases) assert.equal(evaluate({ roas }).reasonCode, reason);
  assert.equal(evaluate({ budget: 6500, roas: '6.00000001' }).budgetProposedCents, 7000);
});

test('covers budget boundaries and exact precedence', () => {
  const cases = [[1400, 'WOULD_CLAMP_TO_GLOBAL_MIN', 1500], [1500, 'WOULD_INCREASE', 2500],
    [2500, 'WOULD_INCREASE', 3500], [3500, 'WOULD_INCREASE', 4500], [4500, 'WOULD_INCREASE', 5500],
    [5500, 'WOULD_INCREASE', 6500], [6500, 'WOULD_INCREASE', 7000], [7000, 'HOLD_MAX_BUDGET', 7000],
    [7100, 'WOULD_CLAMP_TO_GLOBAL_MAX', 7000]];
  for (const [budget, reason, proposed] of cases) {
    const result = evaluate({ budget, roas: '7' });
    assert.equal(result.reasonCode, reason); assert.equal(result.budgetProposedCents, proposed);
  }
  assert.equal(evaluate({ hour: 2, budget: 7100, roas: '7' }).reasonCode, 'WOULD_REDUCE_TO_NIGHT_CAP');
  assert.equal(evaluate({ metricsStatus: 'STALE', hour: 2, budget: 7100 }).reasonCode, 'HOLD_DATA_NOT_RELIABLE');
});

test('covers the night/day minute boundaries in Europe/Madrid', () => {
  const cases = [[23, 59, 'WOULD_INCREASE'], [0, 0, 'HOLD_NIGHT'], [6, 59, 'HOLD_NIGHT'],
    [7, 0, 'WOULD_INCREASE'], [7, 1, 'WOULD_INCREASE']];
  for (const [hour, minute, reason] of cases) assert.equal(evaluate({ hour, minute, budget: 3500, roas: '7' }).reasonCode, reason);
});

test('Madrid conversion handles DST jumps and repeated hours while UTC idempotency keys stay unique', () => {
  const beforeSpringJump = madridBusinessTime(new Date('2026-03-29T00:59:00Z'));
  const afterSpringJump = madridBusinessTime(new Date('2026-03-29T01:01:00Z'));
  assert.equal(beforeSpringJump.hour, 1); assert.equal(afterSpringJump.hour, 3);
  const fallA = madridBusinessTime(new Date('2026-10-25T00:30:00Z'));
  const fallB = madridBusinessTime(new Date('2026-10-25T01:30:00Z'));
  assert.equal(fallA.hour, 2); assert.equal(fallB.hour, 2);
  assert.notEqual(fallA.evaluationHour, fallB.evaluationHour);
  assert.match(fallA.localTime, /\+02:00\[Europe\/Madrid\]$/);
  assert.match(fallB.localTime, /\+01:00\[Europe\/Madrid\]$/);
});

test('fails closed on unavailable ROAS, freshness, currency, inactive campaigns and ABO', () => {
  for (const roas of [null, undefined, '', 'NaN', 'Infinity', Number.NaN, Number.POSITIVE_INFINITY, 'bad']) {
    assert.equal(evaluate({ roas }).reasonCode, 'HOLD_ROAS_UNAVAILABLE');
  }
  for (const status of ['STALE', 'INCOMPLETE', 'FAILED', 'INVALID']) {
    assert.equal(evaluate({ metricsStatus: status, roas: '10' }).reasonCode, 'HOLD_DATA_NOT_RELIABLE');
  }
  assert.equal(evaluate({ currency: 'USD', roas: '10' }).reasonCode, 'BLOCK_POLICY_CURRENCY');
  assert.equal(evaluate({ campaignStatus: 'PAUSED', roas: '10' }).reasonCode, 'HOLD_CAMPAIGN_NOT_ACTIVE');
  assert.equal(evaluate({ budgetModel: 'ABO', budgetPeriod: 'MULTIPLE', budget: null, roas: '10' }).reasonCode,
    'SIMULATION_ONLY_REVIEW_ABO');
});
