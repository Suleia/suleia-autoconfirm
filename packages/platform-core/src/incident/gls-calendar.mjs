import { GLS_POLICY_VERSION } from './gls-policies.mjs';

const DAY_MS = 86_400_000;

function madridParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDate(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateParts(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Requested date must be YYYY-MM-DD');
  return madridParts(parsed);
}

function addCalendarDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  return new Date(value.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function isGlsBusinessDate(date, holidays = []) {
  const parts = dateParts(date);
  return !['Sat', 'Sun'].includes(parts.weekday) && !new Set(holidays).has(date);
}

export function nextGlsBusinessDate(date, holidays = [], count = 1) {
  let candidate = date;
  let remaining = count;
  while (remaining > 0) {
    candidate = addCalendarDays(candidate, 1);
    if (isGlsBusinessDate(candidate, holidays)) remaining -= 1;
  }
  return candidate;
}

export function evaluateGlsDeliveryDate({
  now = new Date(),
  requestedDate = null,
  holidays = [],
  cutoffHour = 17
} = {}) {
  const parts = madridParts(now);
  const today = localDate(parts);
  const afterCutoff = Number(parts.hour) >= cutoffHour;
  const managementDelay = afterCutoff ? 2 : 1;
  const earliest = nextGlsBusinessDate(today, holidays, managementDelay);
  const requestedBusinessDay = requestedDate ? isGlsBusinessDate(requestedDate, holidays) : null;
  const feasible = requestedDate
    ? requestedBusinessDay && requestedDate >= earliest
    : true;
  const reasons = [];
  if (afterCutoff) reasons.push('AFTER_GLS_CUTOFF_NO_NEXT_DAY_GUARANTEE');
  if (requestedDate === today) reasons.push('SAME_DAY_REDELIVERY_NOT_ALLOWED');
  if (requestedDate && !requestedBusinessDay) reasons.push('REQUESTED_DATE_NOT_BUSINESS_DAY');
  if (requestedDate && requestedDate < earliest) reasons.push('REQUESTED_DATE_BEFORE_EARLIEST_OPERATIONAL_DATE');
  if (!reasons.length) reasons.push(requestedDate ? 'REQUESTED_DATE_OPERATIONALLY_POSSIBLE_NOT_GUARANTEED' : 'EARLIEST_OPERATIONAL_ESTIMATE');
  return Object.freeze({
    timezone: 'Europe/Madrid',
    local_date: today,
    local_hour: Number(parts.hour),
    business_day: isGlsBusinessDate(today, holidays),
    weekend: ['Sat', 'Sun'].includes(parts.weekday),
    holiday: holidays.includes(today),
    after_cutoff: afterCutoff,
    cutoff_hour: cutoffHour,
    requested_date: requestedDate,
    earliest_operational_date: earliest,
    feasible,
    reason: reasons,
    requires_human_review: !feasible || afterCutoff,
    guarantee: false,
    policy_version: GLS_POLICY_VERSION
  });
}
