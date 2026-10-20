// Use the provider's observed budget, preserving headroom for other workers.
export function contactRequestSpacing(headers) {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  if (!headers.has('x-ratelimit-remaining') || !Number.isFinite(limit)
      || limit <= 0 || !Number.isFinite(remaining) || remaining < 0) return 8000;
  if (remaining >= Math.max(100, limit * 0.1)) return 1500;
  return remaining >= 50 ? 8000 : 20000;
}
