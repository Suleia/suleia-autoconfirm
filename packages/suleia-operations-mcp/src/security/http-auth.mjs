import crypto from 'node:crypto';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createBearerAuth(config) {
  return function bearerAuth(req, res, next) {
    const header = String(req.headers.authorization || '');
    const [scheme, token] = header.split(/\s+/, 2);
    if (scheme !== 'Bearer' || !token || !safeEqual(token, config.bearerToken)) {
      res.set('WWW-Authenticate', 'Bearer realm="suleia-staging", scope="orders:read orders:simulate"');
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    req.authContext = {
      principal: 'staging-bearer-client',
      scopes: config.grantedScopes
    };
    next();
  };
}

export function createRateLimiter(config) {
  const windows = new Map();
  return function rateLimit(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      windows.set(key, { startedAt: now, count: 1 });
      next();
      return;
    }
    current.count += 1;
    if (current.count > config.rateLimitPerMinute) {
      res.status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }
    next();
  };
}
