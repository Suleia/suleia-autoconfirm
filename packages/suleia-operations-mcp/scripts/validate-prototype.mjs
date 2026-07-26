import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = spawnSync(process.execPath, ['--test'], {
  cwd: packageRoot,
  encoding: 'utf8'
});
process.stdout.write(tests.stdout);
process.stderr.write(tests.stderr);
if (tests.status !== 0) process.exit(tests.status || 1);

const client = spawnSync(process.execPath, [path.join(packageRoot, 'scripts', 'local-client.mjs')], {
  cwd: packageRoot,
  encoding: 'utf8'
});
process.stdout.write(client.stdout);
process.stderr.write(client.stderr);
if (client.status !== 0) process.exit(client.status || 1);

process.stdout.write('Prototype validation completed without production access.\n');
