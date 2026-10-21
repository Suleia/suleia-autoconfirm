const BASE = 'https://api.trendtrack.io';
const ALLOWED = new Set(['/v1/me', '/v1/usage']);

export class TrendtrackError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Phase 1 has a hard credit budget of zero: no metered endpoints.
export function createClient({ key, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!key || /[\r\n]/.test(key)) throw new TrendtrackError('INVALID_LOCAL_KEY');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new TrendtrackError('INVALID_TIMEOUT');
  return {
    async get(path) {
      if (!ALLOWED.has(path)) throw new TrendtrackError('ENDPOINT_BLOCKED');
      let response;
      try {
        response = await fetchImpl(BASE + path, {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Do not expose fetch exceptions, request objects or credentials.
        throw new TrendtrackError('NETWORK_OR_TIMEOUT');
      }
      if (!response.ok) throw new TrendtrackError('HTTP_ERROR', response.status);
      for (const name of ['x-usage-cost', 'x-credits-used']) {
        const value = response.headers.get(name);
        if (value !== null && (!Number.isFinite(Number(value)) || Number(value) !== 0))
          throw new TrendtrackError('UNEXPECTED_CREDIT_COST');
      }
      let body;
      try { body = await response.json(); }
      catch { throw new TrendtrackError('INVALID_JSON'); }
      const valid = body && typeof body === 'object' && !Array.isArray(body) &&
        ((body.data && typeof body.data === 'object') ||
         (path === '/v1/me' && body.credential && body.workspace) ||
         (path === '/v1/usage' && body.credits && body.billing));
      if (!valid)
        throw new TrendtrackError('INVALID_RESPONSE');
      return { status: response.status, body, headers: response.headers };
    },
  };
}
