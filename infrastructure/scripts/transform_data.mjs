import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node transform_data.mjs masked-input.json output.json');
}

const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const rows = Array.isArray(input) ? input : [];
const transformed = rows.map((row, index) => ({
  source: row.source || 'supabase_staging',
  source_record_id: String(row.id || index + 1),
  entity_type: row.entity_type || 'order',
  payload: row,
  payload_checksum: crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex'),
  deduplication_key: `migration:${row.entity_type || 'order'}:${row.id || index + 1}`,
  run_mode: 'SIMULATION'
}));

await fs.writeFile(outputPath, `${JSON.stringify(transformed, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, rows: transformed.length, actions_executed: 0 }));
