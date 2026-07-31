import crypto from 'node:crypto';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

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

function oauthChallenge(config) {
  const metadataUrl = `${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`;
  return `Bearer resource_metadata="${metadataUrl}", scope="${config.grantedScopes.join(' ')}"`;
}

function classifyJwtFailure(error, token, config) {
  try {
    const payload = decodeJwt(token);
    if (payload.iss !== config.oauthIssuer) return 'JWT_ISSUER_MISMATCH';
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.oauthAudience)) return 'JWT_AUDIENCE_MISMATCH';
    if (typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1000)) {
      return 'JWT_EXPIRED';
    }
  } catch {
    return 'JWT_MALFORMED';
  }

  const code = String(error?.code || '');
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'JWT_SIGNATURE_INVALID';
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return 'JWT_KEY_NOT_FOUND';
  if (code === 'ERR_JOSE_ALG_NOT_ALLOWED') return 'JWT_ALGORITHM_INVALID';
  if (code === 'ERR_JWT_EXPIRED') return 'JWT_EXPIRED';
  return 'JWT_VERIFICATION_FAILED';
}

export function createOAuthAuth(config, audit = null, options = {}) {
  const jwks = options.jwks || createRemoteJWKSet(new URL(config.oauthJwksUrl));
  const verify = options.verify || ((token) => jwtVerify(token, jwks, {
    issuer: config.oauthIssuer,
    audience: config.oauthAudience,
    algorithms: ['RS256']
  }));

  return async function oauthAuth(req, res, next) {
    const header = String(req.headers.authorization || '');
    const [scheme, token] = header.split(/\s+/, 2);
    if (scheme !== 'Bearer' || !token) {
      res.set('WWW-Authenticate', oauthChallenge(config));
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const { payload } = await verify(token);
      const scopes = String(payload.scope || '').split(/\s+/).filter(Boolean);
      const roles = Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : [];
      const hasRequiredScopes = config.grantedScopes.every((scope) => scopes.includes(scope));
      if (!roles.includes(config.oauthRequiredRole) || !hasRequiredScopes) {
        audit?.security({
          event: 'mcp_auth_failure',
          requestId: req.correlationId,
          outcome: 'blocked',
          errorCode: roles.includes(config.oauthRequiredRole)
            ? 'MISSING_REQUIRED_SCOPE'
            : 'MISSING_REQUIRED_ROLE'
        });
        res.set('WWW-Authenticate', oauthChallenge(config));
        res.status(403).json({ ok: false, error: 'insufficient_scope' });
        return;
      }
      req.authContext = {
        principal: String(payload.sub || 'oauth-subject'),
        scopes: config.grantedScopes
      };
      next();
    } catch (error) {
      audit?.security({
        event: 'mcp_auth_failure',
        requestId: req.correlationId,
        outcome: 'blocked',
        errorCode: classifyJwtFailure(error, token, config)
      });
      res.set('WWW-Authenticate', oauthChallenge(config));
      res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  };
}

export function createHttpAuth(config, audit = null, options = {}) {
  return config.authMode === 'oauth'
    ? createOAuthAuth(config, audit, options)
    : createBearerAuth(config, audit);
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
