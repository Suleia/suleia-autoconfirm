import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function element() {
  return {
    hidden: true,
    textContent: '',
    href: '',
    disabled: false,
    setAttribute(name, value) { this[name] = value; },
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
}

test('login is prepared before it is shown and uses native link navigation', async () => {
  const script = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const elements = new Map([
    'login-button', 'login-notice', 'login', 'app', 'logout-button',
    'refresh-button', 'prev-page', 'next-page', 'close-drawer', 'drawer-backdrop',
  ].map((id) => [id, element()]));
  const storage = new Map();
  const location = {
    origin: 'https://mcp.suleia.com',
    pathname: '/operations/',
    search: '',
  };
  const context = {
    URL,
    URLSearchParams,
    TextEncoder,
    btoa,
    crypto: webcrypto,
    location,
    history: { replaceState() {} },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      title: 'Operations Center',
      getElementById: (id) => elements.get(id) || element(),
      querySelectorAll: () => [],
      addEventListener() {},
      visibilityState: 'visible',
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        oauth: {
          issuer: 'https://mcp.suleia.com/auth/realms/suleia',
          client_id: 'suleia-operations-center',
          audience: 'suleia-operations-center',
          scope: 'openid operations:read',
        },
        refresh_interval_seconds: 45,
      }),
    }),
    setInterval() {},
    Intl,
    console,
  };

  await vm.runInNewContext(script, context);

  const button = elements.get('login-button');
  const authorize = new URL(button.href);
  assert.equal(authorize.origin, 'https://mcp.suleia.com');
  assert.equal(authorize.pathname, '/auth/realms/suleia/protocol/openid-connect/auth');
  assert.equal(authorize.searchParams.get('client_id'), 'suleia-operations-center');
  assert.equal(authorize.searchParams.get('scope'), 'openid operations:read');
  assert.equal(authorize.searchParams.get('redirect_uri'), 'https://mcp.suleia.com/operations/');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  assert.equal(button['aria-disabled'], 'false');
  assert.equal(button.textContent, 'Iniciar sesión');
  assert.equal(elements.get('login').hidden, false);
  assert.equal(elements.get('app').hidden, true);
  assert.ok(storage.get('suleia_pkce_verifier'));
  assert.ok(storage.get('suleia_oauth_state'));
});
