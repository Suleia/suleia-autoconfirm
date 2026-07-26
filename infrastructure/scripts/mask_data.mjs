import fs from 'node:fs';
import readline from 'node:readline';
import { maskRecord, containsDirectPii } from '../../packages/platform-core/src/masking.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node mask_data.mjs input.jsonl output.jsonl');
}

const input = readline.createInterface({
  input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
  crlfDelay: Infinity
});
const output = fs.createWriteStream(outputPath, { encoding: 'utf8', mode: 0o600 });
let rows = 0;

for await (const line of input) {
  if (!line.trim()) continue;
  const masked = maskRecord(JSON.parse(line));
  if (containsDirectPii(masked)) throw new Error(`PII validation failed at row ${rows + 1}`);
  output.write(`${JSON.stringify(masked)}\n`);
  rows += 1;
}

output.end();
console.log(JSON.stringify({ ok: true, rows, actions_executed: 0, run_mode: 'SIMULATION' }));
