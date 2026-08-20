import './isolated-env.mjs';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const isolatedPaths = [
  process.env.STORE_CONFIG_PATH,
  process.env.STATE_PATH,
  process.env.ORDERS_PATH,
  process.env.WEBHOOK_EVENTS_PATH
];

test('the preload replaces every inherited persistence path with one dedicated temp directory', () => {
  const parents = new Set(isolatedPaths.map((value) => path.dirname(path.resolve(value))));
  assert.equal(parents.size, 1);
  const [parent] = parents;
  const relative = path.relative(path.resolve(os.tmpdir()), parent);
  assert.equal(relative.startsWith('..') || path.isAbsolute(relative), false);
  assert.match(path.basename(parent), /^suleia-confirmation-regression-\d+-/);
});

test('the preload disables every legacy real-action switch by default', () => {
  assert.equal(process.env.AUTO_POLL_ENABLED, 'false');
  assert.equal(process.env.AGENT_ENABLED, 'false');
  assert.equal(process.env.AGENT_DRY_RUN, 'true');
  assert.equal(process.env.DELAYED_CONFIRM_REAL_ENABLED, 'false');
  assert.equal(process.env.UNANSWERED_REJECT_REAL_ENABLED, 'false');
  assert.equal(process.env.INCIDENT_RESOLUTION_REAL_ENABLED, 'false');
});

test('the preload removes inherited credentials and blocks unmocked egress', async () => {
  for (const name of [
    'CHATBY_TOKEN',
    'DROPEA_API_KEY',
    'DROPEA_ACCESS_TOKEN',
    'DROPEA_STORES_CONFIG',
    'DROPEA_ACTIONS_STORES_CONFIG',
    'SHOPIFY_ADMIN_ACCESS_TOKEN',
    'OPENAI_API_KEY',
    'META_ACCESS_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY'
  ]) assert.equal(process.env[name], undefined, name);

  await assert.rejects(
    globalThis.fetch('https://egress-probe.invalid/fixture'),
    /CONFIRMATION_REGRESSION_EGRESS_BLOCKED:https:\/\/egress-probe\.invalid/
  );
});

test('direct stateful test invocation replaces hostile inherited paths before any write', () => {
  const hostile = fs.mkdtempSync(path.join(os.tmpdir(), 'suleia-hostile-inherited-paths-'));
  const inherited = {
    STORE_CONFIG_PATH: path.join(hostile, 'stores-sentinel.json'),
    STATE_PATH: path.join(hostile, 'state-sentinel.json'),
    ORDERS_PATH: path.join(hostile, 'orders-sentinel.json'),
    WEBHOOK_EVENTS_PATH: path.join(hostile, 'webhooks-sentinel.json')
  };
  const expected = new Map();

  try {
    for (const [name, target] of Object.entries(inherited)) {
      const content = `${JSON.stringify({ sentinel: name })}\n`;
      fs.writeFileSync(target, content, 'utf8');
      expected.set(target, content);
    }

    const result = spawnSync(
      process.execPath,
      ['--test', path.join(here, 'legacy-flow-characterization.test.mjs')],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...inherited },
        encoding: 'utf8',
        timeout: 30_000
      }
    );

    assert.equal(
      result.status,
      0,
      `direct regression invocation failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
    for (const [target, content] of expected) {
      assert.equal(fs.readFileSync(target, 'utf8'), content, `${target} was modified`);
    }
  } finally {
    fs.rmSync(hostile, { recursive: true, force: true });
  }
});
