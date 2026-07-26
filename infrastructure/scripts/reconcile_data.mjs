import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const [expectedPath, actualPath] = process.argv.slice(2);
if (!expectedPath || !actualPath) {
  throw new Error('Usage: node reconcile_data.mjs expected.json actual.json');
}

const [expected, actual] = await Promise.all([
  fs.readFile(expectedPath, 'utf8').then(JSON.parse),
  fs.readFile(actualPath, 'utf8').then(JSON.parse)
]);
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const result = {
  expected_count: expected.length,
  actual_count: actual.length,
  expected_checksum: digest(expected),
  actual_checksum: digest(actual),
  status: expected.length === actual.length && digest(expected) === digest(actual) ? 'MATCH' : 'MISMATCH',
  actions_executed: 0,
  run_mode: 'SIMULATION'
};
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'MATCH') process.exitCode = 1;
