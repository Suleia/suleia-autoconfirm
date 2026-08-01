import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Operations Center exposes exactly Pedidos and Incidencias with no write controls', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.equal((html.match(/class="nav-item/g) || []).length, 2);
  assert.match(html, />Pedidos</);
  assert.match(html, />Incidencias</);
  assert.doesNotMatch(`${html}\n${script}\n${css}`, /shopify/i);
  assert.equal((script.match(/method\s*:\s*['"]POST['"]/gi) || []).length, 1);
  assert.match(script, /openid-connect\/token/);
  assert.doesNotMatch(script, /method\s*:\s*['"](?:PUT|PATCH|DELETE)['"]/i);
  assert.match(html, /Acciones ejecutadas: 0/);
  assert.match(script, /refresh_interval_seconds/);
});
