// Use the provider's observed budget, preserving headroom for other workers.
export function contactRequestSpacing(headers) {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  if (!headers.has('x-ratelimit-remaining') || !Number.isFinite(limit)
      || limit <= 0 || !Number.isFinite(remaining) || remaining < 0) return 8000;
  if (remaining >= Math.max(100, limit * 0.1)) return 1500;
  return remaining >= 50 ? 8000 : 20000;
}

// Bulk maintenance yields before exhausting a budget shared with messaging.
// Without a reset header this is a maintenance pause, not a claimed reset time.
export function contactBudgetYieldUntil(headers, now = Date.now()) {
  if (!headers.has('x-ratelimit-remaining')) return null;
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const limit = Number(headers.get('x-ratelimit-limit'));
  if (!Number.isFinite(remaining) || remaining < 0 || !Number.isFinite(limit)
      || limit <= 0 || remaining >= Math.max(100, limit * 0.1)) return null;
  const retry = headers.get('retry-after');
  const seconds = retry === null ? NaN : Number(retry);
  const retryTime = Number.isFinite(seconds) && seconds > 0
    ? now + seconds * 1000 : Date.parse(retry || '');
  const reset = headers.get('x-ratelimit-reset');
  const resetNumber = reset === null ? NaN : Number(reset);
  const resetTime = Number.isFinite(resetNumber) && resetNumber > 0
    ? resetNumber > 1e12 ? resetNumber
      : resetNumber > 1e9 ? resetNumber * 1000 : now + resetNumber * 1000
    : Date.parse(reset || '');
  const observed = [retryTime, resetTime].filter(t => Number.isFinite(t) && t > now);
  return new Date(observed.length ? Math.max(now + 60000, ...observed) : now + 20 * 60000).toISOString();
}
