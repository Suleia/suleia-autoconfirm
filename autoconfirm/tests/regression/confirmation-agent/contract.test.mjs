import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../..');
const manifest = JSON.parse(await fs.readFile(path.join(here, 'frozen-files.json'), 'utf8'));

function gitBlobOid(content) {
  const raw = Buffer.from(content);
  const normalized = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'));
  return [raw, normalized].map((candidate) => {
    const header = Buffer.from(`blob ${candidate.length}\0`);
    return crypto.createHash('sha1').update(Buffer.concat([header, candidate])).digest('hex');
  });
}

test('the production confirmation flow remains byte-for-byte equal to its frozen Git blobs', async () => {
  assert.equal(manifest.baseline_commit, '9569b01cc9af936bcf919dee5fe9f33d7151057d');
  for (const [relativePath, expectedOid] of Object.entries(manifest.files)) {
    const content = await fs.readFile(path.join(repositoryRoot, relativePath));
    assert.ok(
      gitBlobOid(content).includes(expectedOid),
      `${relativePath} changed outside an explicitly authorized baseline update`
    );
  }
});

test('package entrypoints remain equal to main except for the additive regression command', async () => {
  for (const [relativePath, rule] of Object.entries(manifest.json_files_with_test_only_additions || {})) {
    const packagePath = path.join(repositoryRoot, relativePath);
    const parsed = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    for (const scriptName of rule.allowed_script_additions) {
      assert.equal(typeof parsed.scripts?.[scriptName], 'string', `${relativePath} is missing ${scriptName}`);
      delete parsed.scripts[scriptName];
    }

    const reconstructedBaseline = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    assert.ok(
      gitBlobOid(reconstructedBaseline).includes(rule.baseline_oid),
      `${relativePath} changed beyond the explicitly allowed test-only script additions`
    );
  }
});

test('runtime state artifacts are explicitly excluded from the functional-freeze commit', async () => {
  const runtimeArtifacts = [
    'autoconfirm/data/stores.json',
    'autoconfirm/data/state.json',
    'autoconfirm/data/orders.json',
    'autoconfirm/data/webhook-events.json'
  ];
  const ignoreRules = await fs.readFile(path.join(repositoryRoot, '.gitignore'), 'utf8');
  for (const relativePath of runtimeArtifacts) {
    assert.match(ignoreRules, new RegExp(`^/${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.equal(Object.hasOwn(manifest.files, relativePath), false);
    assert.throws(() => execFileSync(
      'git', ['ls-files', '--error-unmatch', '--', relativePath],
      { cwd: repositoryRoot, stdio: 'ignore' }
    ), (error) => error?.status === 1, `${relativePath} must not be tracked or staged`);
  }
});

test('the frozen contract includes entrypoints, decision logic, adapters, persistence and schedules', () => {
  const paths = Object.keys(manifest.files);
  for (const required of [
    'autoconfirm/server.mjs',
    'autoconfirm/src/workflows/orders.mjs',
    'autoconfirm/src/clients/dropea-v2-order-actions.mjs',
    'autoconfirm/src/clients/chatby.mjs',
    'autoconfirm/src/clients/shopify.mjs',
    'autoconfirm/src/clients/sheets.mjs',
    'autoconfirm/src/clients/meta-whatsapp.mjs',
    'autoconfirm/src/clients/supabase.mjs',
    'autoconfirm/src/storage.mjs',
    'autoconfirm/src/db/supabase-store.mjs',
    'autoconfirm/src/workflows/telegram-agent.mjs',
    'autoconfirm/tools/auto-confirm.mjs',
    'autoconfirm/tools/unanswered-cancellations.mjs',
    'autoconfirm/tools/poll-orders.mjs',
    'autoconfirm/scripts/render-cron-unanswered-cancellations.mjs',
    'infrastructure/vps/suleia-render-automation.timer'
  ]) assert.ok(paths.includes(required), required);
});

test('the local dependency graph of every production confirmation entrypoint is closed by the frozen manifest', async () => {
  const frozen = new Set(Object.keys(manifest.files));
  const pending = [
    'autoconfirm/server.mjs',
    'autoconfirm/tools/poll-orders.mjs',
    'autoconfirm/scripts/render-cron-unanswered-cancellations.mjs',
    'autoconfirm/tools/auto-confirm.mjs',
    'autoconfirm/tools/unanswered-cancellations.mjs'
  ];
  const visited = new Set();

  while (pending.length) {
    const relativePath = pending.pop();
    if (visited.has(relativePath)) continue;
    visited.add(relativePath);
    assert.ok(frozen.has(relativePath), `unfrozen local dependency: ${relativePath}`);

    const source = await fs.readFile(path.join(repositoryRoot, relativePath), 'utf8');
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g)
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      const absoluteDependency = path.resolve(path.dirname(path.join(repositoryRoot, relativePath)), specifier);
      const withExtension = path.extname(absoluteDependency) ? absoluteDependency : `${absoluteDependency}.mjs`;
      const dependency = path.relative(repositoryRoot, withExtension).split(path.sep).join('/');
      assert.equal(dependency.startsWith('../'), false, `${relativePath} escapes the repository via ${specifier}`);
      pending.push(dependency);
    }
  }
});
