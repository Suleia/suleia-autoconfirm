export const META_BUDGET_POLICY_VERSION = 'META_BUDGET_POLICY_V1';

export const META_BUDGET_POLICY_V1 = Object.freeze({
  minDailyBudgetCents: 1_500,
  maxDailyBudgetCents: 7_000,
  nightMaxDailyBudgetCents: 3_500,
  scaleIncrementCents: 1_000,
  scaleRoasThreshold: '6',
  lowRoasThreshold: '3',
  nightStart: '00:00',
  dayScalingStart: '07:00',
  timezone: 'Europe/Madrid',
  evaluationIntervalMinutes: 60
});

const RELIABLE_METRICS_STATUS = 'FRESH';

function assertCents(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be non-negative integer cents`);
  return value;
}

function decimalParts(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  return { numerator: (BigInt(whole) * denominator) + BigInt(fraction || '0'), denominator, canonical: raw };
}

function compareDecimal(left, right) {
  const a = decimalParts(left); const b = decimalParts(right);
  if (!a || !b) return null;
  const difference = (a.numerator * b.denominator) - (b.numerator * a.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function minutesOfDay(value, field) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) throw new Error(`${field} must use HH:mm`);
  const hour = Number(match[1]); const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`${field} is outside a day`);
  return (hour * 60) + minute;
}

export function validateMetaBudgetPolicy(policy = META_BUDGET_POLICY_V1) {
  assertCents(policy.minDailyBudgetCents, 'minDailyBudgetCents');
  assertCents(policy.maxDailyBudgetCents, 'maxDailyBudgetCents');
  assertCents(policy.nightMaxDailyBudgetCents, 'nightMaxDailyBudgetCents');
  assertCents(policy.scaleIncrementCents, 'scaleIncrementCents');
  if (policy.minDailyBudgetCents > policy.maxDailyBudgetCents
    || policy.nightMaxDailyBudgetCents > policy.maxDailyBudgetCents
    || policy.scaleIncrementCents === 0) throw new Error('Meta budget limits are inconsistent');
  if (!decimalParts(policy.scaleRoasThreshold) || !decimalParts(policy.lowRoasThreshold)
    || compareDecimal(policy.lowRoasThreshold, policy.scaleRoasThreshold) >= 0) throw new Error('ROAS thresholds are inconsistent');
  const night = minutesOfDay(policy.nightStart, 'nightStart');
  const day = minutesOfDay(policy.dayScalingStart, 'dayScalingStart');
  if (night === day) throw new Error('Night and day boundaries must differ');
  if (policy.timezone !== 'Europe/Madrid') throw new Error('Meta policy timezone must remain Europe/Madrid');
  if (policy.evaluationIntervalMinutes !== 60) throw new Error('Meta policy evaluation interval must remain hourly');
  return policy;
}

export function madridBusinessTime(at = new Date(), timezone = META_BUDGET_POLICY_V1.timezone) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid evaluation timestamp');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZoneName: 'longOffset'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const offset = String(value.timeZoneName || 'GMT').replace('GMT', '') || '+00:00';
  return Object.freeze({
    timezone,
    year: Number(value.year), month: Number(value.month), day: Number(value.day),
    hour: Number(value.hour), minute: Number(value.minute), second: Number(value.second),
    minuteOfDay: (Number(value.hour) * 60) + Number(value.minute),
    localTime: `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}${offset}[${timezone}]`,
    evaluationHour: new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000).toISOString()
  });
}

export function isNightWindow(localMinute, policy = META_BUDGET_POLICY_V1) {
  validateMetaBudgetPolicy(policy);
  const start = minutesOfDay(policy.nightStart, 'nightStart');
  const end = minutesOfDay(policy.dayScalingStart, 'dayScalingStart');
  return start < end ? localMinute >= start && localMinute < end : localMinute >= start || localMinute < end;
}

function result({ decisionType, reasonCode, reasonText, before, proposed = before, wouldExecute = false }) {
  return Object.freeze({
    decisionType,
    reasonCode,
    reasonText,
    budgetBeforeCents: before,
    budgetProposedCents: proposed,
    budgetDeltaCents: before === null || proposed === null ? null : proposed - before,
    wouldExecute
  });
}

export function evaluateMetaBudgetPolicy({
  currentBudgetCents,
  purchaseRoas,
  metricsStatus,
  budgetModel = 'CBO',
  budgetPeriod = 'DAILY',
  campaignStatus = 'ACTIVE',
  currency = 'EUR',
  evaluatedAt = new Date(),
  policy = META_BUDGET_POLICY_V1
}) {
  validateMetaBudgetPolicy(policy);
  const local = madridBusinessTime(evaluatedAt, policy.timezone);
  const validBudget = Number.isSafeInteger(currentBudgetCents) && currentBudgetCents >= 0;
  const before = validBudget ? currentBudgetCents : null;
  const decorate = (decision) => Object.freeze({ ...decision, ...local, policyVersion: META_BUDGET_POLICY_VERSION,
    nightWindow: isNightWindow(local.minuteOfDay, policy) });

  if (!['FRESH', 'STALE', 'INCOMPLETE', 'FAILED'].includes(metricsStatus) || metricsStatus !== RELIABLE_METRICS_STATUS) {
    return decorate(result({ decisionType: 'HOLD', reasonCode: 'HOLD_DATA_NOT_RELIABLE',
      reasonText: `Metrics status ${metricsStatus || 'INVALID'} is not reliable`, before }));
  }
  if (currency !== 'EUR') return decorate(result({ decisionType: 'BLOCK_POLICY', reasonCode: 'BLOCK_POLICY_CURRENCY',
    reasonText: 'Account currency must be EUR', before }));
  if (campaignStatus !== 'ACTIVE') return decorate(result({ decisionType: 'HOLD', reasonCode: 'HOLD_CAMPAIGN_NOT_ACTIVE',
    reasonText: 'Campaign is not active', before }));
  if (budgetModel === 'ABO') return decorate(result({ decisionType: 'SIMULATION_ONLY_REVIEW', reasonCode: 'SIMULATION_ONLY_REVIEW_ABO',
    reasonText: 'ABO allocation requires a separately approved ad-set policy', before }));
  if (budgetModel !== 'CBO' || budgetPeriod !== 'DAILY' || !validBudget) {
    return decorate(result({ decisionType: 'BLOCK_POLICY', reasonCode: 'BLOCK_POLICY_BUDGET_MODEL',
      reasonText: 'A valid CBO daily budget is required', before }));
  }

  const night = isNightWindow(local.minuteOfDay, policy);
  if (night && before > policy.nightMaxDailyBudgetCents) {
    return decorate(result({ decisionType: 'WOULD_CHANGE', reasonCode: 'WOULD_REDUCE_TO_NIGHT_CAP',
      reasonText: 'Night budget exceeds the 35 EUR cap', before, proposed: policy.nightMaxDailyBudgetCents, wouldExecute: true }));
  }
  if (night) return decorate(result({ decisionType: 'HOLD', reasonCode: 'HOLD_NIGHT',
    reasonText: 'Budget scaling is disabled from 00:00 through 06:59 Europe/Madrid', before }));
  if (before > policy.maxDailyBudgetCents) return decorate(result({ decisionType: 'WOULD_CHANGE',
    reasonCode: 'WOULD_CLAMP_TO_GLOBAL_MAX', reasonText: 'Budget exceeds the global maximum', before,
    proposed: policy.maxDailyBudgetCents, wouldExecute: true }));
  if (before < policy.minDailyBudgetCents) return decorate(result({ decisionType: 'WOULD_CHANGE',
    reasonCode: 'WOULD_CLAMP_TO_GLOBAL_MIN', reasonText: 'Budget is below the global minimum', before,
    proposed: policy.minDailyBudgetCents, wouldExecute: true }));

  const roas = decimalParts(purchaseRoas);
  if (!roas) return decorate(result({ decisionType: 'HOLD', reasonCode: 'HOLD_ROAS_UNAVAILABLE',
    reasonText: 'Purchase ROAS is unavailable or malformed', before }));
  const versusScale = compareDecimal(roas.canonical, policy.scaleRoasThreshold);
  if (versusScale > 0 && before < policy.maxDailyBudgetCents) {
    const proposed = Math.min(policy.maxDailyBudgetCents, before + policy.scaleIncrementCents);
    return decorate(result({ decisionType: 'WOULD_CHANGE', reasonCode: 'WOULD_INCREASE',
      reasonText: 'Purchase ROAS is strictly above 6 during the day', before, proposed, wouldExecute: true }));
  }
  if (versusScale > 0 && before === policy.maxDailyBudgetCents) return decorate(result({ decisionType: 'HOLD',
    reasonCode: 'HOLD_MAX_BUDGET', reasonText: 'Campaign is already at the global maximum', before }));
  if (compareDecimal(roas.canonical, policy.lowRoasThreshold) < 0) return decorate(result({ decisionType: 'HOLD',
    reasonCode: 'HOLD_LOW_ROAS', reasonText: 'Purchase ROAS is below 3; reductions are not enabled', before }));
  return decorate(result({ decisionType: 'HOLD', reasonCode: 'HOLD_ROAS_NEUTRAL',
    reasonText: 'Purchase ROAS is between 3 and 6 inclusive', before }));
}

export function publicMetaBudgetPolicy() {
  const policy = validateMetaBudgetPolicy(META_BUDGET_POLICY_V1);
  return Object.freeze({
    policy_version: META_BUDGET_POLICY_VERSION,
    currency: 'EUR', timezone: policy.timezone, evaluation_interval_minutes: policy.evaluationIntervalMinutes,
    min_daily_budget_cents: policy.minDailyBudgetCents, max_daily_budget_cents: policy.maxDailyBudgetCents,
    night_max_daily_budget_cents: policy.nightMaxDailyBudgetCents, scale_increment_cents: policy.scaleIncrementCents,
    night_start: policy.nightStart, day_scaling_start: policy.dayScalingStart,
    scale_roas_threshold: policy.scaleRoasThreshold, low_roas_threshold: policy.lowRoasThreshold,
    approval_required_enabled: false, live_enabled: false, meta_writes_enabled: false,
    external_actions_enabled: false, production_writes: 0, meta_budget_writes: 0, external_actions: 0
  });
}
