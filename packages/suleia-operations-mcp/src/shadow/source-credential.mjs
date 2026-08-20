const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export class ShadowSourceCredentialError extends Error {
  constructor(code) {
    super(`Unsafe Supabase shadow credential: ${code}`);
    this.name = 'ShadowSourceCredentialError';
    this.code = code;
  }
}

function decodeJwtPart(value, code) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new ShadowSourceCredentialError(code);
  }
}

export function loadShadowSourceCredential(env = process.env, { now = Date.now, expectedIssuer } = {}) {
  if (hasOwn(env, 'SUPABASE_SERVICE_ROLE_KEY') && env.SUPABASE_SERVICE_ROLE_KEY !== undefined) {
    throw new ShadowSourceCredentialError('SERVICE_ROLE_FORBIDDEN');
  }
  const apiKey = String(env.SUPABASE_PUBLISHABLE_KEY || '');
  if (apiKey.startsWith('sb_secret_')) {
    throw new ShadowSourceCredentialError('SECRET_API_KEY_FORBIDDEN');
  }
  if (!apiKey.startsWith('sb_publishable_')) {
    throw new ShadowSourceCredentialError('PUBLISHABLE_KEY_REQUIRED');
  }
  const bearerToken = String(env.SUPABASE_SHADOW_READER_TOKEN || '');
  if (bearerToken.startsWith('sb_secret_')) {
    throw new ShadowSourceCredentialError('SECRET_BEARER_FORBIDDEN');
  }
  const parts = bearerToken.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new ShadowSourceCredentialError('READER_JWT_REQUIRED');
  }
  const header = decodeJwtPart(parts[0], 'READER_JWT_HEADER_INVALID');
  const claims = decodeJwtPart(parts[1], 'READER_JWT_CLAIMS_INVALID');
  if (!header.alg || String(header.alg).toLowerCase() === 'none') {
    throw new ShadowSourceCredentialError('READER_JWT_ALGORITHM_INVALID');
  }
  if (claims.role !== 'suleia_shadow_reader') {
    throw new ShadowSourceCredentialError('READER_ROLE_INVALID');
  }
  if (!expectedIssuer || claims.iss !== expectedIssuer) {
    throw new ShadowSourceCredentialError('READER_ISSUER_INVALID');
  }
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) * 1000 <= now()) {
    throw new ShadowSourceCredentialError('READER_JWT_EXPIRED');
  }
  return Object.freeze({
    apiKey,
    bearerToken,
    role: claims.role,
    issuer: claims.iss,
    expiresAt: Number(claims.exp) * 1000,
    signatureValidation: 'DELEGATED_TO_SUPABASE'
  });
}
