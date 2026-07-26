export const SCOPES = Object.freeze({
  READ: 'orders:read',
  SIMULATE: 'orders:simulate'
});

export function requireScopes(context, required) {
  const available = new Set(context?.scopes || []);
  const missing = required.filter((scope) => !available.has(scope));
  if (missing.length) {
    const error = new Error(`Missing required scopes: ${missing.join(', ')}`);
    error.code = 'INSUFFICIENT_SCOPE';
    throw error;
  }
}
