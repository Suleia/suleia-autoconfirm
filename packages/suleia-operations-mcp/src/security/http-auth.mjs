import crypto from 'node:crypto';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createBearerAuth(config, audit = null) {
  return function bearerAuth(req, res, next) {
    const header = String(req.headers.authorization || '');
    const [scheme, token] = header.split(/\s+/, 2);
    if (scheme !== 'Bearer' || !token || !safeEqual(token, config.bearerToken)) {
      audit?.security({
        event: 'mcp_auth_failure',
        requestId: req.correlationId,
        outcome: 'blocked',
        errorCode: 'UNAUTHORIZED'
      });
      res.set('WWW-Authenticate', `Bearer realm="suleia-private-staging", scope="${config.grantedScopes.join(' ')}"`);
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

export function createRateLimiter(config, audit = null) {
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
      audit?.security({
        event: 'mcp_rate_limit',
        requestId: req.correlationId,
        outcome: 'blocked',
        errorCode: 'RATE_LIMITED'
      });
      res.set('Retry-After', String(Math.max(1, Math.ceil((60_000 - (now - current.startedAt)) / 1000))));
      res.status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }
    next();
  };
}
