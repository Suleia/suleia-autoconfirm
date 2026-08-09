import fs from 'node:fs';
import path from 'node:path';

const outputDirectory = path.resolve(process.argv[2] || 'docs/audit/2026-08-09-phase0');
const input = fs.readFileSync(0, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const records = input.map((line, index) => {
  try { return JSON.parse(line); }
  catch { throw new Error(`Invalid audit JSON at input line ${index + 1}`); }
});

const findings = records.filter((record) => record.record_kind === 'finding');
const databaseObjects = records.filter((record) => record.record_kind === 'db_object');
const databaseCatalog = records.filter((record) => record.record_kind === 'db_catalog');
if (findings.length !== 239) throw new Error(`Expected 239 findings, received ${findings.length}`);
if (new Set(findings.map((finding) => finding.finding_id)).size !== findings.length) {
  throw new Error('Finding identifiers are not unique');
}
if (findings.some((finding) => 'canonical_order_id' in finding || 'canonical_issue_id' in finding)) {
  throw new Error('Raw operational identifiers are forbidden in the audit artifact');
}

const columns = [
  'finding_id', 'title', 'component', 'severity', 'status', 'duplicate_of',
  'evidence', 'root_cause', 'impact', 'proposed_correction', 'acceptance_test',
  'related_commit', 'related_deployment', 'owner', 'target_date', 'residual_risk',
  'order_ref_masked', 'issue_ref_masked', 'source_kind', 'detected_at'
];
const escapeCsv = (value) => {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = [columns.join(','), ...findings.map((finding) => columns.map((column) => escapeCsv(finding[column])).join(','))].join('\n') + '\n';

const databaseColumns = ['schema_name', 'object_name', 'object_kind', 'row_security', 'owner_name'];
const databaseCsv = [databaseColumns.join(','), ...databaseObjects.map((item) => databaseColumns.map((column) => escapeCsv(item[column])).join(','))].join('\n') + '\n';
const catalogColumns = ['category', 'schema_name', 'object_name', 'detail_name', 'technical_type', 'nullable', 'definition'];
const catalogCsv = [catalogColumns.join(','), ...databaseCatalog.map((item) => catalogColumns.map((column) => escapeCsv(item[column])).join(','))].join('\n') + '\n';

const countBy = (key) => Object.fromEntries([...new Set(findings.map((finding) => finding[key]))].sort().map((value) => [value, findings.filter((finding) => finding[key] === value).length]));
const summary = {
  schema_version: 'suleia-phase0-findings-v1',
  generated_at: new Date().toISOString(),
  total_findings: findings.length,
  unique_findings: new Set(findings.map((finding) => finding.finding_id)).size,
  linked_duplicates: findings.filter((finding) => finding.status === 'DUPLICATE' && finding.duplicate_of).length,
  orphan_duplicates: findings.filter((finding) => finding.status === 'DUPLICATE' && !finding.duplicate_of).length,
  by_status: countBy('status'),
  by_severity: countBy('severity'),
  by_component: countBy('component'),
  database_objects: databaseObjects.length,
  database_catalog_entries: databaseCatalog.length,
  pii_values_included: false,
  actions_executed: 0,
  production_writes: 0
};

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, 'findings-register.csv'), csv, { encoding: 'utf8', mode: 0o600 });
fs.writeFileSync(path.join(outputDirectory, 'database-objects.csv'), databaseCsv, { encoding: 'utf8', mode: 0o600 });
fs.writeFileSync(path.join(outputDirectory, 'database-technical-catalog.csv'), catalogCsv, { encoding: 'utf8', mode: 0o600 });
fs.writeFileSync(path.join(outputDirectory, 'findings-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify(summary));
