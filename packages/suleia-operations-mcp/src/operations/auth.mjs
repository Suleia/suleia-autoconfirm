import crypto from 'node:crypto';

export class OperationsAuthError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function createOperationsAuth(config, { verify = null } = {}) {
  if (!config.issuer?.startsWith('https://') || !config.audience || !config.jwksUrl || !config.requiredRole) {
    throw new Error('Operations OAuth configuration is incomplete');
  }
  let verifier = verify;
  async function verifyToken(token) {
    if (!verifier) {
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
      verifier = (value) => jwtVerify(value, jwks, {
        issuer: config.issuer, audience: config.audience, algorithms: ['RS256']
      });
    }
    return verifier(token);
  }
  return async function authenticate(req) {
    const [scheme, token] = String(req.headers.authorization || '').split(/\s+/, 2);
    if (scheme !== 'Bearer' || !token) throw new OperationsAuthError('UNAUTHORIZED');
    try {
      const { payload } = await verifyToken(token);
      const roles = Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : [];
      const scopes = String(payload.scope || '').split(/\s+/).filter(Boolean);
      if (!roles.includes(config.requiredRole) || !scopes.includes('operations:read')) {
        throw new OperationsAuthError('INSUFFICIENT_SCOPE', 403);
      }
      return Object.freeze({
        principal_hash: crypto.createHash('sha256').update(String(payload.sub || '')).digest('hex'),
        expires_at: payload.exp || null,
        scopes: ['operations:read']
      });
    } catch (error) {
      if (error instanceof OperationsAuthError) throw error;
      throw new OperationsAuthError('UNAUTHORIZED');
    }
  };
}
