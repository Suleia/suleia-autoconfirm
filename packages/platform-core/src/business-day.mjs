const formatterCache = new Map();

function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }));
  }
  return formatterCache.get(timeZone);
}

function partsAt(instant, timeZone) {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
}

function localMidnightUtc({ year, month, day }, timeZone) {
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = partsAt(new Date(candidate), timeZone);
    const represented = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    const next = candidate - (represented - desired);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

function nextCalendarDate({ year, month, day }) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  };
}

function isoDate({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function businessDateAt(now = new Date(), timeZone = 'Europe/Madrid') {
  const parts = partsAt(now, timeZone);
  return isoDate(parts);
}

export function businessDayBounds({
  businessDate = null,
  now = new Date(),
  timeZone = 'Europe/Madrid'
} = {}) {
  const selected = businessDate || businessDateAt(now, timeZone);
  const match = String(selected).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('businessDate must use YYYY-MM-DD');
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
  const start = localMidnightUtc(date, timeZone);
  const end = localMidnightUtc(nextCalendarDate(date), timeZone);
  if (!(end > start)) throw new Error('Invalid business-day interval');
  return Object.freeze({
    business_date: isoDate(date),
    time_zone: timeZone,
    local_start: `${isoDate(date)}T00:00:00`,
    local_end_exclusive: `${isoDate(nextCalendarDate(date))}T00:00:00`,
    utc_start: start.toISOString(),
    utc_end_exclusive: end.toISOString(),
    duration_hours: (end.getTime() - start.getTime()) / 3_600_000
  });
}

export function isWithinBusinessDay(createdAt, bounds) {
  const instant = new Date(createdAt).getTime();
  return Number.isFinite(instant)
    && instant >= new Date(bounds.utc_start).getTime()
    && instant < new Date(bounds.utc_end_exclusive).getTime();
}
