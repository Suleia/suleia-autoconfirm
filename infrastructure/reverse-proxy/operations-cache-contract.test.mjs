import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const caddyfile = readFileSync(
  new URL('./McpEdgeCaddyfile', import.meta.url),
  'utf8',
);

test('Operations Center UI responses cannot reuse stale frontend assets', () => {
  const operationsUi = caddyfile.match(
    /@operations_ui path \/operations\/\*[\s\S]*?handle @operations_ui \{([\s\S]*?)\n  \}/,
  )?.[1];
  assert.ok(operationsUi, 'missing Operations Center UI handler');
  assert.match(operationsUi, /header Cache-Control "no-store"/);

  const operationsHost = caddyfile.match(
    /\{\$OPS_PUBLIC_HOST\} \{([\s\S]*)\n\}/,
  )?.[1];
  assert.ok(operationsHost, 'missing standalone Operations Center host');
  assert.match(
    operationsHost,
    /handle \{\s*header Cache-Control "no-store"\s*reverse_proxy review-panel:80/,
  );
});
